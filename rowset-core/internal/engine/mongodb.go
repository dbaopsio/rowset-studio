package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
)

func mongoClient(connection Connection) (*mongo.Client, error) {
	if connection.SSH.enabled() {
		return nil, errors.New("MongoDB SSH tunnelling is not supported yet")
	}
	tls, err := tlsConfig(connection.TLS, connection.Host)
	if err != nil {
		return nil, err
	}
	opts := options.Client().SetHosts([]string{net.JoinHostPort(connection.Host, fmt.Sprint(connection.Port))}).SetConnectTimeout(10 * time.Second).SetServerSelectionTimeout(10 * time.Second)
	if tls != nil {
		opts.SetTLSConfig(tls)
	}
	if connection.Username != "" {
		opts.SetAuth(options.Credential{AuthSource: "admin", Username: connection.Username, Password: connection.Password})
	}
	return mongo.Connect(opts)
}
func closeMongo(client *mongo.Client) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = client.Disconnect(ctx)
}
func mongoTest(ctx context.Context, connection Connection) error {
	client, err := mongoClient(connection)
	if err != nil {
		return err
	}
	defer closeMongo(client)
	return client.Ping(ctx, readpref.Primary())
}
func mongoDatabases(ctx context.Context, connection Connection) ([]string, error) {
	client, err := mongoClient(connection)
	if err != nil {
		return nil, err
	}
	defer closeMongo(client)
	return client.ListDatabaseNames(ctx, bson.D{})
}
func mongoSchema(ctx context.Context, connection Connection) (Schema, error) {
	result := Schema{Tables: map[string][]Column{}, Indexes: map[string][]Index{}, Views: map[string]bool{}}
	client, err := mongoClient(connection)
	if err != nil {
		return result, err
	}
	defer closeMongo(client)
	names, err := client.Database(connection.Database).ListCollectionNames(ctx, bson.D{})
	if err != nil {
		return result, err
	}
	for _, name := range names {
		result.Tables[tableKey(connection.Database, name)] = []Column{{Schema: connection.Database, Table: name, Name: "document", DataType: "BSON", Nullable: false}}
	}
	return result, nil
}

type MongoFindInput struct {
	Database   string          `json:"database"`
	Collection string          `json:"collection"`
	Filter     json.RawMessage `json:"filter"`
	Project    json.RawMessage `json:"project"`
	Sort       json.RawMessage `json:"sort"`
	Skip       int             `json:"skip"`
	Limit      int             `json:"limit"`
	MaxTimeMs  int64           `json:"maxTimeMs"`
}

func ParseMongoFilter(raw json.RawMessage) (bson.D, error) {
	if len(raw) == 0 {
		raw = json.RawMessage(`{}`)
	}
	var filter bson.D
	if err := bson.UnmarshalExtJSON(raw, false, &filter); err != nil {
		return nil, fmt.Errorf("filter must be an Extended JSON object: %w", err)
	}
	// This explorer only finds documents; server-side JavaScript is not needed.
	var reject func(any) bool
	reject = func(v any) bool {
		switch x := v.(type) {
		case bson.D:
			for _, e := range x {
				if e.Key == "$where" || e.Key == "$function" || e.Key == "$accumulator" || reject(e.Value) {
					return true
				}
			}
		case bson.A:
			for _, e := range x {
				if reject(e) {
					return true
				}
			}
		}
		return false
	}
	if reject(filter) {
		return nil, errors.New("server-side JavaScript is not supported in document filters")
	}
	return filter, nil
}

func (m *Manager) MongoFind(ctx context.Context, connection Connection, input MongoFindInput) ([]json.RawMessage, bool, error) {
	if strings.TrimSpace(input.Collection) == "" || strings.ContainsRune(input.Collection, 0) {
		return nil, false, errors.New("collection is required")
	}
	filter, err := ParseMongoFilter(input.Filter)
	if err != nil {
		return nil, false, err
	}
	var sort bson.D
	if len(input.Sort) > 0 {
		if err = bson.UnmarshalExtJSON(input.Sort, false, &sort); err != nil {
			return nil, false, errors.New("sort must be an object of field names and 1 or -1")
		}
	}
	for _, e := range sort {
		if fmt.Sprint(e.Value) != "1" && fmt.Sprint(e.Value) != "-1" {
			return nil, false, errors.New("sort directions must be 1 or -1")
		}
	}
	var project bson.D
	if len(input.Project) > 0 {
		if err = bson.UnmarshalExtJSON(input.Project, false, &project); err != nil {
			return nil, false, errors.New("project must be an object of field names and 0 or 1")
		}
	}
	if input.Skip < 0 {
		return nil, false, errors.New("skip must be zero or a positive integer")
	}
	if input.MaxTimeMs < 0 || input.MaxTimeMs > 600000 {
		return nil, false, errors.New("maxTimeMs must be between 0 and 600000")
	}
	if input.Limit < 1 || input.Limit > 10000 {
		return nil, false, errors.New("limit must be between 1 and 10000")
	}
	client, err := mongoClient(connection)
	if err != nil {
		return nil, false, err
	}
	defer closeMongo(client)
	opts := options.Find().SetLimit(int64(input.Limit + 1))
	if len(sort) > 0 {
		opts.SetSort(sort)
	}
	if len(project) > 0 {
		opts.SetProjection(project)
	}
	if input.Skip > 0 {
		opts.SetSkip(int64(input.Skip))
	}
	if input.MaxTimeMs > 0 {
		var timeoutCancel context.CancelFunc
		ctx, timeoutCancel = context.WithTimeout(ctx, time.Duration(input.MaxTimeMs)*time.Millisecond)
		defer timeoutCancel()
	}
	cursor, err := client.Database(connection.Database).Collection(input.Collection).Find(ctx, filter, opts)
	if err != nil {
		return nil, false, err
	}
	defer cursor.Close(ctx)
	docs := []json.RawMessage{}
	for cursor.Next(ctx) {
		if len(docs) == input.Limit {
			return docs, true, nil
		}
		raw, err := bson.MarshalExtJSON(cursor.Current, true, false)
		if err != nil {
			return nil, false, err
		}
		docs = append(docs, json.RawMessage(raw))
	}
	return docs, false, cursor.Err()
}
