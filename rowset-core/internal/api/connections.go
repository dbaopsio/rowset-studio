package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/engine"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/id"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/store"
)

type connectionInput struct {
	Name             string  `json:"name"`
	Alias            *string `json:"alias"`
	Engine           string  `json:"engine"`
	Host             string  `json:"host"`
	Port             int     `json:"port"`
	Database         *string `json:"database"`
	Environment      string  `json:"environment"`
	TLSRequired      *bool   `json:"tlsRequired"`
	TLSMode          *string `json:"tlsMode"`
	TLSServerName    *string `json:"tlsServerName"`
	TLSCAPEM         *string `json:"tlsCaPem"`
	TLSClientCertPEM *string `json:"tlsClientCertPem"`
	// TLSClientKey is write-only: nil keeps the stored key, "" removes it.
	TLSClientKey        *string      `json:"tlsClientKey"`
	ConnectionUsername  string       `json:"connectionUsername"`
	TechnicalUsername   string       `json:"techUsername"`
	Password            string       `json:"password"`
	QueryTimeoutSeconds *int64       `json:"queryTimeoutSeconds"`
	Nodes               *[]nodeInput `json:"nodes"`
}
type nodeInput struct {
	ID   *string `json:"id"`
	Name string  `json:"name"`
	Host string  `json:"host"`
	Port int     `json:"port"`
}

func (s *Server) listConnections(w http.ResponseWriter, r *http.Request) {
	identity := identityFromContext(r.Context())
	connections, err := s.store.ListConnections(r.Context(), identity.OrgID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "failed to list connections")
		return
	}
	if !identity.IsAdmin() {
		role, err := s.store.UserRole(r.Context(), identity.UserID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "role missing")
			return
		}
		access, _ := s.store.ListRoleConnectionAccess(r.Context(), role.ID)
		allowed := map[string]domain.RoleConnectionAccess{}
		for _, item := range access {
			allowed[item.ConnectionID] = item
		}
		visible := connections[:0]
		for _, connection := range connections {
			if _, ok := allowed[connection.ID]; ok {
				visible = append(visible, connection)
			}
		}
		connections = visible
	}
	output := make([]map[string]any, 0, len(connections))
	for _, connection := range connections {
		output = append(output, s.connectionJSON(r, connection, identity))
	}
	writeJSON(w, http.StatusOK, map[string]any{"connections": output})
}

func (s *Server) connectionJSON(r *http.Request, connection domain.Connection, identity domain.Identity) map[string]any {
	nodes, _ := s.store.ListConnectionNodes(r.Context(), connection.ID)
	if nodes == nil {
		nodes = []domain.ConnectionNode{}
	}
	alias := connection.Name
	if connection.Alias != nil {
		alias = *connection.Alias
	}
	result := map[string]any{"id": connection.ID, "name": connection.Name, "alias": alias, "engine": connection.Engine, "host": connection.Host, "port": connection.Port, "database": connection.Database, "environment": connection.Environment, "tlsRequired": connection.EffectiveTLSMode() != engine.TLSDisable, "tlsMode": connection.EffectiveTLSMode(), "tlsServerName": connection.TLSServerName, "tlsCaPem": connection.TLSCAPEM, "tlsClientCertPem": connection.TLSClientCertPEM, "tlsClientKeyConfigured": connection.TLSClientKeySecret != "", "connectionUsername": connection.ConnectionUsername, "techUsername": connection.ConnectionUsername, "createdAt": connection.CreatedAt, "queryTimeoutSeconds": connection.QueryTimeoutSeconds, "nodes": nodes}
	for _, detail := range s.connectionDetails {
		detail(r.Context(), connection, result)
	}
	if !identity.IsAdmin() {
		if role, err := s.store.UserRole(r.Context(), identity.UserID); err == nil {
			access, _ := s.store.ListRoleConnectionAccess(r.Context(), role.ID)
			for _, item := range access {
				if item.ConnectionID == connection.ID {
					result["nodePolicy"] = item.NodePolicy
					result["defaultNodeRole"] = item.DefaultNodeRole
					break
				}
			}
		}
	}
	return result
}
func (s *Server) createConnection(w http.ResponseWriter, r *http.Request) {
	var input connectionInput
	body, ok := s.decodeConnectionInput(w, r, &input)
	if !ok {
		return
	}
	connection, nodes, message := normalizeConnectionInput(input, nil, identityFromContext(r.Context()).OrgID)
	if message != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", message)
		return
	}
	if s.vault == nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "secret vault unavailable")
		return
	}
	createdKey, _, ok := s.applyTLSClientKey(w, r, input, &connection, nil)
	if !ok {
		return
	}
	discardKey := func() {
		if createdKey != "" {
			_ = s.store.DeleteSecret(r.Context(), createdKey)
		}
	}
	ciphertext, nonce, err := s.vault.Encrypt([]byte(input.Password))
	if err != nil {
		discardKey()
		writeError(w, http.StatusInternalServerError, "INTERNAL", "secret encryption failed")
		return
	}
	secret := domain.Secret{ID: id.New(), Ciphertext: ciphertext, Nonce: nonce}
	connection.SecretID = secret.ID
	if err := s.store.CreateSecret(r.Context(), secret); err != nil {
		discardKey()
		writeStoreError(w, err)
		return
	}
	if err := s.store.CreateConnection(r.Context(), connection); err != nil {
		_ = s.store.DeleteSecret(r.Context(), secret.ID)
		discardKey()
		writeStoreError(w, err)
		return
	}
	if err := s.store.ReplaceConnectionNodes(r.Context(), connection.ID, nodes); err != nil {
		_ = s.store.DeleteConnection(r.Context(), connection.ID)
		_ = s.store.DeleteSecret(r.Context(), secret.ID)
		discardKey()
		writeStoreError(w, err)
		return
	}
	if err := s.runConnectionSaveHooks(r.Context(), connection, true, body); err != nil {
		_ = s.store.DeleteConnection(r.Context(), connection.ID)
		_ = s.store.DeleteSecret(r.Context(), secret.ID)
		discardKey()
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, s.connectionJSON(r, connection, identityFromContext(r.Context())))
}

func (s *Server) updateConnection(w http.ResponseWriter, r *http.Request) {
	identity := identityFromContext(r.Context())
	existing, err := s.store.Connection(r.Context(), r.PathValue("id"))
	if err != nil || existing.OrgID != identity.OrgID {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "connection not found")
		return
	}
	var input connectionInput
	body, ok := s.decodeConnectionInput(w, r, &input)
	if !ok {
		return
	}
	connection, nodes, message := normalizeConnectionInput(input, &existing, identity.OrgID)
	if message != "" {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", message)
		return
	}
	connection.SecretID = existing.SecretID
	createdKey, replacedKey, ok := s.applyTLSClientKey(w, r, input, &connection, &existing)
	if !ok {
		return
	}
	discardKey := func() {
		if createdKey != "" {
			_ = s.store.DeleteSecret(r.Context(), createdKey)
		}
	}
	var newSecret *domain.Secret
	if input.Password != "" {
		ciphertext, nonce, err := s.vault.Encrypt([]byte(input.Password))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "secret encryption failed")
			return
		}
		newSecret = &domain.Secret{ID: id.New(), Ciphertext: ciphertext, Nonce: nonce}
		connection.SecretID = newSecret.ID
		if err := s.store.CreateSecret(r.Context(), *newSecret); err != nil {
			discardKey()
			writeStoreError(w, err)
			return
		}
	}
	if err := s.store.UpdateConnection(r.Context(), connection); err != nil {
		if newSecret != nil {
			_ = s.store.DeleteSecret(r.Context(), newSecret.ID)
		}
		discardKey()
		writeStoreError(w, err)
		return
	}
	if input.Nodes == nil {
		nodes, _ = s.store.ListConnectionNodes(r.Context(), connection.ID)
		if len(nodes) == 1 {
			nodes[0].Host, nodes[0].Port, nodes[0].DetectedRole, nodes[0].Health, nodes[0].ReadOnly, nodes[0].LastCheckedAt, nodes[0].LastError = connection.Host, connection.Port, "unknown", "unknown", true, nil, nil
		}
	}
	if len(nodes) == 0 {
		nodes, _ = buildNodes(connection.ID, connection.Host, connection.Port, nil)
	}
	if err := s.store.ReplaceConnectionNodes(r.Context(), connection.ID, nodes); err != nil {
		_ = s.store.UpdateConnection(r.Context(), existing)
		if newSecret != nil {
			_ = s.store.DeleteSecret(r.Context(), newSecret.ID)
		}
		discardKey()
		writeStoreError(w, err)
		return
	}
	if newSecret != nil {
		_ = s.store.DeleteSecret(r.Context(), existing.SecretID)
	}
	if replacedKey != "" {
		_ = s.store.DeleteSecret(r.Context(), replacedKey)
	}
	_ = s.engines.Invalidate(connection.ID)
	if err := s.runConnectionSaveHooks(r.Context(), connection, false, body); err != nil {
		writeStoreError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, s.connectionJSON(r, connection, identity))
}

func (s *Server) deleteConnection(w http.ResponseWriter, r *http.Request) {
	identity := identityFromContext(r.Context())
	connection, err := s.store.Connection(r.Context(), r.PathValue("id"))
	if err != nil || connection.OrgID != identity.OrgID {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "connection not found")
		return
	}
	if err := s.store.DeleteConnection(r.Context(), connection.ID); err != nil {
		writeStoreError(w, err)
		return
	}
	_ = s.store.DeleteSecret(r.Context(), connection.SecretID)
	if connection.TLSClientKeySecret != "" {
		_ = s.store.DeleteSecret(r.Context(), connection.TLSClientKeySecret)
	}
	_ = s.engines.Invalidate(connection.ID)
	s.closeConnectionTransactions(connection.ID)
	s.topologyMu.Lock()
	delete(s.topologyLocks, connection.ID)
	s.topologyMu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) engineConnection(r *http.Request, connection domain.Connection, database string) (engine.Connection, error) {
	return s.engineConnectionAt(r.Context(), connection, database, connection.Host, connection.Port)
}

func (s *Server) engineConnectionAt(ctx context.Context, connection domain.Connection, database, host string, port int) (engine.Connection, error) {
	secret, err := s.store.SecretForConnection(ctx, connection.OrgID, connection.ID)
	if err != nil {
		return engine.Connection{}, err
	}
	plaintext, err := s.vault.Decrypt(secret.Ciphertext, secret.Nonce)
	if err != nil {
		return engine.Connection{}, err
	}
	if database == "" {
		database = connection.Database
	}
	settings := engine.TLSSettings{Mode: connection.EffectiveTLSMode(), ServerName: connection.TLSServerName, CAPEM: connection.TLSCAPEM, ClientCertPEM: connection.TLSClientCertPEM}
	if connection.TLSClientKeySecret != "" {
		keySecret, err := s.store.TLSClientKeySecretForConnection(ctx, connection.OrgID, connection.ID)
		if err != nil {
			return engine.Connection{}, err
		}
		key, err := s.vault.Decrypt(keySecret.Ciphertext, keySecret.Nonce)
		if err != nil {
			return engine.Connection{}, err
		}
		settings.ClientKeyPEM = string(key)
	}
	return engine.Connection{ID: connection.ID, Engine: connection.Engine, Host: host, Port: port, Database: database, Username: connection.ConnectionUsername, Password: string(plaintext), TLS: settings, PoolSize: s.poolSize(connection.Engine)}, nil
}

// applyTLSClientKey validates the client certificate/key pair and stores a
// replacement key. It returns the secret this request created and the stored
// secret it replaced, which the caller deletes only after a successful save.
func (s *Server) applyTLSClientKey(w http.ResponseWriter, r *http.Request, input connectionInput, connection *domain.Connection, existing *domain.Connection) (created, replaced string, ok bool) {
	keyPEM := ""
	switch {
	case input.TLSClientKey != nil && strings.TrimSpace(*input.TLSClientKey) != "":
		keyPEM = strings.TrimSpace(*input.TLSClientKey)
	case input.TLSClientKey != nil:
		replaced, connection.TLSClientKeySecret = connection.TLSClientKeySecret, ""
	case connection.TLSClientKeySecret != "" && existing != nil:
		secret, err := s.store.TLSClientKeySecretForConnection(r.Context(), existing.OrgID, existing.ID)
		if err == nil {
			var plaintext []byte
			plaintext, err = s.vault.Decrypt(secret.Ciphertext, secret.Nonce)
			keyPEM = string(plaintext)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, "INTERNAL", "stored TLS client key is unreadable")
			return "", "", false
		}
	}
	if (connection.TLSClientCertPEM == "") != (keyPEM == "") {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "TLS client certificate and private key must be provided together")
		return "", "", false
	}
	if keyPEM != "" {
		if err := engine.ValidateTLSSettings(engine.TLSSettings{Mode: engine.TLSRequire, ClientCertPEM: connection.TLSClientCertPEM, ClientKeyPEM: keyPEM}); err != nil {
			writeError(w, http.StatusBadRequest, "BAD_REQUEST", err.Error())
			return "", "", false
		}
	}
	if input.TLSClientKey == nil || keyPEM == "" {
		return "", replaced, true
	}
	ciphertext, nonce, err := s.vault.Encrypt([]byte(keyPEM))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "secret encryption failed")
		return "", "", false
	}
	secret := domain.Secret{ID: id.New(), Ciphertext: ciphertext, Nonce: nonce}
	if err := s.store.CreateSecret(r.Context(), secret); err != nil {
		writeStoreError(w, err)
		return "", "", false
	}
	replaced, connection.TLSClientKeySecret = connection.TLSClientKeySecret, secret.ID
	return secret.ID, replaced, true
}
func (s *Server) poolSize(engineName string) int {
	switch strings.ToLower(engineName) {
	case "postgres", "postgresql":
		return int(s.config.PostgresPoolSize)
	case "mysql", "mariadb":
		return int(s.config.MySQLPoolSize)
	case "mssql", "sqlserver":
		return int(s.config.MSSQLPoolSize)
	default:
		return 10
	}
}

func withConnectionTimeout(r *http.Request, connection domain.Connection, policySeconds int, fallback time.Duration) (context.Context, context.CancelFunc) {
	timeout := fallback
	if connection.QueryTimeoutSeconds > 0 {
		configured := time.Duration(connection.QueryTimeoutSeconds) * time.Second
		if configured < timeout || fallback > time.Minute {
			timeout = configured
		}
	}
	if policySeconds > 0 {
		configured := time.Duration(policySeconds) * time.Second
		if configured < timeout {
			timeout = configured
		}
	}
	return context.WithTimeout(r.Context(), timeout)
}

func (s *Server) testConnection(w http.ResponseWriter, r *http.Request) {
	identity := identityFromContext(r.Context())
	connection, err := s.store.Connection(r.Context(), r.PathValue("id"))
	if err != nil || connection.OrgID != identity.OrgID {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "connection not found")
		return
	}
	target, err := s.engineConnection(r, connection, "")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "latencyMs": 0, "error": err.Error()})
		return
	}
	started := time.Now()
	ctx, cancel := withConnectionTimeout(r, connection, 0, 10*time.Second)
	defer cancel()
	err = s.engines.Test(ctx, target)
	response := map[string]any{"ok": err == nil, "latencyMs": time.Since(started).Milliseconds()}
	if err != nil {
		response["error"] = err.Error()
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) connectionSchema(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.authorizedConnection(w, r)
	if !ok {
		return
	}
	target, err := s.metadataEngineConnection(r.Context(), connection, strings.TrimSpace(r.URL.Query().Get("database")))
	if err != nil {
		writeError(w, http.StatusBadGateway, "EXEC_ERROR", err.Error())
		return
	}
	ctx, cancel := withConnectionTimeout(r, connection, 0, 60*time.Second)
	defer cancel()
	schema, err := s.engines.Schema(ctx, target)
	if err != nil {
		writeError(w, http.StatusBadGateway, "EXEC_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, schemaJSON(schema))
}

func (s *Server) listDatabases(w http.ResponseWriter, r *http.Request) {
	connection, ok := s.authorizedConnection(w, r)
	if !ok {
		return
	}
	target, err := s.metadataEngineConnection(r.Context(), connection, "")
	if err != nil {
		writeError(w, http.StatusBadGateway, "EXEC_ERROR", err.Error())
		return
	}
	ctx, cancel := withConnectionTimeout(r, connection, 0, 60*time.Second)
	defer cancel()
	databases, err := s.engines.Databases(ctx, target)
	if err != nil {
		writeError(w, http.StatusBadGateway, "EXEC_ERROR", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"databases": databases})
}

func (s *Server) authorizedConnection(w http.ResponseWriter, r *http.Request) (domain.Connection, bool) {
	identity := identityFromContext(r.Context())
	connection, err := s.store.Connection(r.Context(), r.PathValue("id"))
	if err != nil || connection.OrgID != identity.OrgID {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "connection not found")
		return connection, false
	}
	if identity.IsAdmin() {
		return connection, true
	}
	role, err := s.store.UserRole(r.Context(), identity.UserID)
	if err == nil {
		access, _ := s.store.ListRoleConnectionAccess(r.Context(), role.ID)
		for _, item := range access {
			if item.ConnectionID == connection.ID {
				return connection, true
			}
		}
	}
	writeError(w, http.StatusForbidden, "POLICY_DENIED", "role has no access to this connection")
	return connection, false
}

func normalizeConnectionInput(input connectionInput, existing *domain.Connection, orgID string) (domain.Connection, []domain.ConnectionNode, string) {
	if strings.TrimSpace(input.ConnectionUsername) == "" {
		input.ConnectionUsername = input.TechnicalUsername
	}
	input.Name, input.Engine, input.Host, input.ConnectionUsername = strings.TrimSpace(input.Name), strings.ToLower(strings.TrimSpace(input.Engine)), strings.TrimSpace(input.Host), strings.TrimSpace(input.ConnectionUsername)
	if input.Name == "" || input.Engine == "" || input.Host == "" || input.ConnectionUsername == "" || input.Port < 1 || input.Port > 65535 || (existing == nil && input.Password == "") {
		return domain.Connection{}, nil, "connection fields are required"
	}
	if input.Engine == "sqlserver" {
		input.Engine = "mssql"
	}
	defaults := map[string]string{"postgres": "postgres", "mysql": "mysql", "mariadb": "mysql", "mssql": "master"}
	defaultDB, ok := defaults[input.Engine]
	if !ok {
		return domain.Connection{}, nil, "unsupported database engine"
	}
	database := defaultDB
	if input.Database != nil && strings.TrimSpace(*input.Database) != "" {
		database = strings.TrimSpace(*input.Database)
	}
	environment := strings.ToLower(strings.TrimSpace(input.Environment))
	switch environment {
	case "", "dev", "development", "local", "test":
		environment = "dev"
	case "prod", "production", "prd":
		environment = "prod"
	default:
		return domain.Connection{}, nil, "environment must be dev or prod"
	}
	alias := input.Alias
	tlsMode, serverName, caPEM, clientCert, clientKeySecret := engine.TLSVerifyFull, "", "", "", ""
	timeout := int64(600)
	connectionID, createdAt := id.New(), store.NowString()
	if existing != nil {
		connectionID, createdAt, timeout = existing.ID, existing.CreatedAt, existing.QueryTimeoutSeconds
		tlsMode, serverName, caPEM, clientCert, clientKeySecret = existing.EffectiveTLSMode(), existing.TLSServerName, existing.TLSCAPEM, existing.TLSClientCertPEM, existing.TLSClientKeySecret
	}
	if input.TLSMode != nil {
		mode, err := engine.NormalizeTLSMode(*input.TLSMode)
		if err != nil {
			return domain.Connection{}, nil, "tlsMode must be disable, require, verify-ca or verify-full"
		}
		tlsMode = mode
	} else if input.TLSRequired != nil {
		// Clients predating tlsMode: "on" never weakens a stored mode.
		if !*input.TLSRequired {
			tlsMode = engine.TLSDisable
		} else if tlsMode == engine.TLSDisable {
			tlsMode = engine.TLSVerifyFull
		}
	}
	if input.TLSServerName != nil {
		serverName = strings.TrimSpace(*input.TLSServerName)
	}
	if input.TLSCAPEM != nil {
		caPEM = strings.TrimSpace(*input.TLSCAPEM)
	}
	if input.TLSClientCertPEM != nil {
		clientCert = strings.TrimSpace(*input.TLSClientCertPEM)
	}
	if caPEM != "" {
		if err := engine.ValidateTLSSettings(engine.TLSSettings{Mode: engine.TLSVerifyFull, CAPEM: caPEM}); err != nil {
			return domain.Connection{}, nil, err.Error()
		}
	}
	if input.QueryTimeoutSeconds != nil {
		timeout = *input.QueryTimeoutSeconds
	}
	if timeout < 1 || timeout > 86400 {
		return domain.Connection{}, nil, "queryTimeoutSeconds must be between 1 and 86400"
	}
	connection := domain.Connection{ID: connectionID, OrgID: orgID, Name: input.Name, Alias: alias, Engine: input.Engine, Host: input.Host, Port: input.Port, Database: database, Environment: environment, TLSRequired: tlsMode != engine.TLSDisable, TLSMode: tlsMode, TLSServerName: serverName, TLSCAPEM: caPEM, TLSClientCertPEM: clientCert, TLSClientKeySecret: clientKeySecret, ConnectionUsername: input.ConnectionUsername, CreatedAt: createdAt, QueryTimeoutSeconds: timeout}
	var nodeInputs []nodeInput
	if input.Nodes != nil {
		nodeInputs = *input.Nodes
	}
	nodes, message := buildNodes(connectionID, input.Host, input.Port, nodeInputs)
	return connection, nodes, message
}

func buildNodes(connectionID, fallbackHost string, fallbackPort int, input []nodeInput) ([]domain.ConnectionNode, string) {
	if len(input) == 0 {
		input = []nodeInput{{Name: "node-1", Host: fallbackHost, Port: fallbackPort}}
	}
	names, endpoints := map[string]bool{}, map[string]bool{}
	now := store.NowString()
	result := make([]domain.ConnectionNode, 0, len(input))
	for _, item := range input {
		item.Name, item.Host = strings.TrimSpace(item.Name), strings.TrimSpace(item.Host)
		nameKey, endpoint := strings.ToLower(item.Name), strings.ToLower(item.Host)+":"+strconv.Itoa(item.Port)
		if item.Name == "" || item.Host == "" || item.Port < 1 || item.Port > 65535 {
			return nil, "each node requires a name, host and valid port"
		}
		if names[nameKey] || endpoints[endpoint] {
			return nil, "node names and endpoints must be unique"
		}
		names[nameKey], endpoints[endpoint] = true, true
		nodeID := id.New()
		if item.ID != nil && strings.TrimSpace(*item.ID) != "" {
			nodeID = strings.TrimSpace(*item.ID)
		}
		result = append(result, domain.ConnectionNode{ID: nodeID, ConnectionID: connectionID, Name: item.Name, Host: item.Host, Port: item.Port, DetectedRole: "unknown", Health: "unknown", ReadOnly: true, CreatedAt: now})
	}
	return result, ""
}

func schemaJSON(schema engine.Schema) map[string]any {
	type schemaNode struct {
		Tables, Views      []map[string]any
		Routines, Triggers []map[string]any
	}
	bySchema := map[string]*schemaNode{}
	names := make([]string, 0)
	for key, columns := range schema.Tables {
		schemaName, tableName := "default", key
		if index := strings.Index(key, "."); index >= 0 {
			schemaName, tableName = key[:index], key[index+1:]
		}
		if len(columns) > 0 {
			schemaName, tableName = columns[0].Schema, columns[0].Table
		}
		if bySchema[schemaName] == nil {
			bySchema[schemaName] = &schemaNode{}
			names = append(names, schemaName)
		}
		columnJSON := make([]map[string]any, 0, len(columns))
		for _, column := range columns {
			value := map[string]any{"name": column.Name, "dataType": column.DataType, "nullable": column.Nullable, "pk": column.PrimaryKey}
			value["default"] = column.Default
			value["generated"] = column.Generated
			value["comment"] = column.Comment
			if column.References != "" {
				value["references"] = column.References
			}
			columnJSON = append(columnJSON, value)
		}
		entry := map[string]any{"name": tableName, "columns": columnJSON, "indexes": schema.Indexes[key]}
		if schema.Views[key] {
			bySchema[schemaName].Views = append(bySchema[schemaName].Views, entry)
		} else {
			bySchema[schemaName].Tables = append(bySchema[schemaName].Tables, entry)
		}
	}
	for _, routine := range schema.Routines {
		name := routine.Schema
		if name == "" {
			name = "default"
		}
		if bySchema[name] == nil {
			bySchema[name] = &schemaNode{}
			names = append(names, name)
		}
		bySchema[name].Routines = append(bySchema[name].Routines, map[string]any{"name": routine.Name, "kind": routine.Kind})
	}
	for _, trigger := range schema.Triggers {
		name := trigger.Schema
		if name == "" {
			name = "default"
		}
		if bySchema[name] == nil {
			bySchema[name] = &schemaNode{}
			names = append(names, name)
		}
		bySchema[name].Triggers = append(bySchema[name].Triggers, map[string]any{"name": trigger.Name, "table": trigger.Table, "timing": trigger.Timing, "event": trigger.Event})
	}
	sort.Strings(names)
	output := make([]map[string]any, 0, len(names))
	for _, name := range names {
		node := bySchema[name]
		if node.Tables == nil {
			node.Tables = []map[string]any{}
		}
		if node.Views == nil {
			node.Views = []map[string]any{}
		}
		if node.Routines == nil {
			node.Routines = []map[string]any{}
		}
		if node.Triggers == nil {
			node.Triggers = []map[string]any{}
		}
		output = append(output, map[string]any{"name": name, "tables": node.Tables, "views": node.Views, "routines": node.Routines, "triggers": node.Triggers})
	}
	warnings := schema.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	return map[string]any{"schemas": output, "warnings": warnings}
}

// decodeConnectionInput decodes a connection request body, leaving the fields
// that save hooks claim to those hooks, and returns the raw body.
func (s *Server) decodeConnectionInput(w http.ResponseWriter, r *http.Request, input *connectionInput) ([]byte, bool) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "invalid JSON request")
		return nil, false
	}
	strict := body
	if len(s.connectionFields) > 0 {
		var fields map[string]json.RawMessage
		if json.Unmarshal(body, &fields) == nil {
			for name := range s.connectionFields {
				delete(fields, name)
			}
			strict, _ = json.Marshal(fields)
		}
	}
	r.Body = io.NopCloser(bytes.NewReader(strict))
	return body, decodeJSON(w, r, input)
}

func (s *Server) runConnectionSaveHooks(ctx context.Context, connection domain.Connection, created bool, body []byte) error {
	for _, hook := range s.connectionSaveHooks {
		if err := hook(ctx, connection, created, body); err != nil {
			return err
		}
	}
	return nil
}
