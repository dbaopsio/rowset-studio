package api

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// startAPITestSSHServer runs an in-process SSH server that forwards port
// forwards, so a connection can be tunnelled without a real sshd.
func startAPITestSSHServer(t *testing.T, user, password string) (host string, port int, hostKey string) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromSigner(priv)
	if err != nil {
		t.Fatal(err)
	}
	config := &ssh.ServerConfig{PasswordCallback: func(meta ssh.ConnMetadata, given []byte) (*ssh.Permissions, error) {
		if meta.User() == user && string(given) == password {
			return &ssh.Permissions{}, nil
		}
		return nil, errors.New("denied")
	}}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go apiServeSSH(conn, config)
		}
	}()
	addrHost, portText, _ := net.SplitHostPort(listener.Addr().String())
	p, _ := strconv.Atoi(portText)
	line := signer.PublicKey().Type() + " " + base64.StdEncoding.EncodeToString(signer.PublicKey().Marshal())
	return addrHost, p, line
}

func apiServeSSH(conn net.Conn, config *ssh.ServerConfig) {
	serverConn, channels, requests, err := ssh.NewServerConn(conn, config)
	if err != nil {
		_ = conn.Close()
		return
	}
	defer serverConn.Close()
	go ssh.DiscardRequests(requests)
	for newChannel := range channels {
		if newChannel.ChannelType() != "direct-tcpip" {
			_ = newChannel.Reject(ssh.UnknownChannelType, "no")
			continue
		}
		var payload struct {
			DestAddr string
			DestPort uint32
			OrigAddr string
			OrigPort uint32
		}
		_ = ssh.Unmarshal(newChannel.ExtraData(), &payload)
		target, err := net.DialTimeout("tcp", net.JoinHostPort(payload.DestAddr, strconv.Itoa(int(payload.DestPort))), 5*time.Second)
		if err != nil {
			_ = newChannel.Reject(ssh.ConnectionFailed, err.Error())
			continue
		}
		channel, reqs, err := newChannel.Accept()
		if err != nil {
			_ = target.Close()
			continue
		}
		go ssh.DiscardRequests(reqs)
		go func() {
			defer channel.Close()
			defer target.Close()
			done := make(chan struct{}, 2)
			go func() { _, _ = io.Copy(target, channel); done <- struct{}{} }()
			go func() { _, _ = io.Copy(channel, target); done <- struct{}{} }()
			<-done
		}()
	}
}

// TestLiveSSHTunnelThroughTheAPI drives the whole connection path: discovering
// the host key, saving an SSH-tunnelled connection, and running a query that
// reaches the database only through the tunnel.
func TestLiveSSHTunnelThroughTheAPI(t *testing.T) {
	password := os.Getenv("ROWSET_MATRIX_POSTGRES_PASSWORD")
	if password == "" {
		t.Skip("ROWSET_MATRIX_POSTGRES_PASSWORD is not configured")
	}
	sshHost, sshPort, hostKey := startAPITestSSHServer(t, "tunnel", "tunnelpass")
	s, identity := personalServer(t)

	// Discover and trust the host key, as the form does before saving.
	discover := httptest.NewRecorder()
	body, _ := json.Marshal(map[string]any{"sshHost": sshHost, "sshPort": sshPort, "sshUser": "tunnel", "sshAuthMethod": "password", "sshPassword": "tunnelpass"})
	s.discoverSSHHostKey(discover, personalRequest(identity, string(body)))
	var discovered struct {
		OK          bool
		HostKey     string
		Fingerprint string
	}
	if discover.Code != http.StatusOK || json.Unmarshal(discover.Body.Bytes(), &discovered) != nil || !discovered.OK || discovered.HostKey != hostKey {
		t.Fatalf("host-key discovery: %d %s", discover.Code, discover.Body.String())
	}
	if !strings.HasPrefix(discovered.Fingerprint, "SHA256:") {
		t.Fatalf("fingerprint not shown: %q", discovered.Fingerprint)
	}

	// Save a connection whose database is reached through the tunnel.
	create := httptest.NewRecorder()
	connBody, _ := json.Marshal(map[string]any{
		"name": "pg-via-ssh", "engine": "postgres", "host": "127.0.0.1", "port": 55432,
		"database": "rowset_e2e", "connectionUsername": "postgres", "password": password, "tlsMode": "disable",
		"sshHost": sshHost, "sshPort": sshPort, "sshUser": "tunnel", "sshAuthMethod": "password",
		"sshPassword": "tunnelpass", "sshKnownHost": discovered.HostKey,
	})
	s.createConnection(create, personalRequest(identity, string(connBody)))
	var created struct{ ID string }
	if create.Code != http.StatusCreated || json.Unmarshal(create.Body.Bytes(), &created) != nil {
		t.Fatalf("create: %d %s", create.Code, create.Body.String())
	}

	connection, err := s.store.Connection(context.Background(), created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if connection.SSHHost != sshHost || connection.SSHSecretID == "" || connection.SSHKnownHost != hostKey {
		t.Fatalf("ssh fields not stored: %+v", connection)
	}
	// The SSH password is not returned to the client.
	if strings.Contains(create.Body.String(), "tunnelpass") {
		t.Fatal("the SSH password leaked to the client")
	}

	w := httptest.NewRecorder()
	s.executeQuery(w, personalRequest(identity, `{}`), connection, queryInput{SQL: "SELECT 42 AS answer WHERE 1=1"}, nil)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "42") {
		t.Fatalf("query through the tunnel: %d %s", w.Code, w.Body.String())
	}

	// A saved connection whose host key was never trusted refuses to connect.
	connection.SSHKnownHost = ""
	_ = s.store.UpdateConnection(context.Background(), connection)
	_ = s.engines.Invalidate(connection.ID)
	blocked := httptest.NewRecorder()
	reload, _ := s.store.Connection(context.Background(), created.ID)
	s.executeQuery(blocked, personalRequest(identity, `{}`), reload, queryInput{SQL: "SELECT 1 WHERE 1=1"}, nil)
	if blocked.Code < 300 {
		t.Fatalf("a connection with no trusted host key was allowed: %d %s", blocked.Code, blocked.Body.String())
	}

	// Deleting the connection removes its SSH secret.
	sshSecretID := connection.SSHSecretID
	del := httptest.NewRecorder()
	req := personalRequest(identity, `{}`)
	req.SetPathValue("id", created.ID)
	s.deleteConnection(del, req)
	if _, err := s.store.SSHSecretForConnection(context.Background(), identity.OrgID, created.ID); err == nil {
		t.Fatalf("ssh secret %s survived deletion", sshSecretID)
	}
}
