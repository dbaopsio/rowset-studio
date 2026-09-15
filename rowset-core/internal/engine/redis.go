package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

func redisClient(connection Connection) (*goredis.Client, error) {
	db := 0
	if strings.TrimSpace(connection.Database) != "" {
		parsed, err := strconv.Atoi(strings.TrimSpace(connection.Database))
		if err != nil || parsed < 0 || parsed > 15 {
			return nil, errors.New("database must be a Redis DB index between 0 and 15")
		}
		db = parsed
	}
	tls, err := tlsConfig(connection.TLS, connection.Host)
	if err != nil {
		return nil, err
	}
	return goredis.NewClient(&goredis.Options{
		Addr:         net.JoinHostPort(connection.Host, fmt.Sprint(connection.Port)),
		Username:     connection.Username,
		Password:     connection.Password,
		DB:           db,
		TLSConfig:    tls,
		DialTimeout:  10 * time.Second,
		ReadTimeout:  24 * time.Hour,
	}), nil
}

func redisTest(ctx context.Context, connection Connection) error {
	client, err := redisClient(connection)
	if err != nil {
		return err
	}
	defer client.Close()
	return client.Ping(ctx).Err()
}

// redisDatabases lists the numbered DBs (0-15) that INFO keyspace reports as
// non-empty, always including the connection's own selected DB.
func redisDatabases(ctx context.Context, connection Connection) ([]string, error) {
	client, err := redisClient(connection)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	info, err := client.Info(ctx, "keyspace").Result()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var result []string
	for _, line := range strings.Split(info, "\r\n") {
		if !strings.HasPrefix(line, "db") {
			continue
		}
		name := line[:strings.Index(line, ":")]
		name = strings.TrimPrefix(name, "db")
		if !seen[name] {
			seen[name] = true
			result = append(result, name)
		}
	}
	self := strconv.Itoa(int(client.Options().DB))
	if !seen[self] {
		result = append([]string{self}, result...)
	}
	return result, nil
}

// redisSchema groups a sample of keys by their Redis type (string, hash,
// list, set, zset, stream) as pseudo-tables, since Redis itself has no
// schema. Scanning is capped so a very large keyspace stays responsive.
func redisSchema(ctx context.Context, connection Connection) (Schema, error) {
	result := Schema{Tables: map[string][]Column{}, Indexes: map[string][]Index{}, Views: map[string]bool{}}
	client, err := redisClient(connection)
	if err != nil {
		return result, err
	}
	defer client.Close()
	dbName := strconv.Itoa(int(client.Options().DB))
	types := map[string]int{}
	var cursor uint64
	scanned := 0
	for {
		keys, next, err := client.Scan(ctx, cursor, "*", 500).Result()
		if err != nil {
			return result, err
		}
		for _, key := range keys {
			kind, err := client.Type(ctx, key).Result()
			if err != nil {
				continue
			}
			types[kind]++
		}
		scanned += len(keys)
		cursor = next
		if cursor == 0 || scanned >= 5000 {
			break
		}
	}
	if scanned >= 5000 {
		result.Warnings = append(result.Warnings, "Key types are sampled from the first 5000 keys scanned; the full keyspace may contain other types.")
	}
	for kind, count := range types {
		key := tableKey(dbName, kind)
		result.Tables[key] = []Column{{Schema: dbName, Table: kind, Name: "key", DataType: "string"}, {Schema: dbName, Table: kind, Name: "value", DataType: kind}, {Schema: dbName, Table: kind, Name: "ttl", DataType: "seconds"}}
		_ = count
	}
	return result, nil
}

type RedisScanInput struct {
	Database string `json:"database"`
	Pattern  string `json:"pattern"`
	Type     string `json:"type"`
	Cursor   uint64 `json:"cursor"`
	Limit    int    `json:"limit"`
}

type RedisEntry struct {
	Key   string          `json:"key"`
	Type  string          `json:"type"`
	TTL   int64           `json:"ttl"`
	Value json.RawMessage `json:"value"`
}

// RedisScan lists keys matching a glob pattern (SCAN, never KEYS, so a large
// keyspace never blocks the server) and previews each value, truncated so a
// huge collection or string cannot flood the response.
func (m *Manager) RedisScan(ctx context.Context, connection Connection, input RedisScanInput) ([]RedisEntry, uint64, error) {
	if input.Limit <= 0 {
		input.Limit = 100
	}
	if input.Limit > 1000 {
		return nil, 0, errors.New("limit must be 1000 or less")
	}
	pattern := input.Pattern
	if strings.TrimSpace(pattern) == "" {
		pattern = "*"
	}
	client, err := redisClient(connection)
	if err != nil {
		return nil, 0, err
	}
	defer client.Close()
	var entries []RedisEntry
	cursor := input.Cursor
	for len(entries) < input.Limit {
		keys, next, err := client.Scan(ctx, cursor, pattern, int64(input.Limit)).Result()
		if err != nil {
			return nil, 0, err
		}
		for _, key := range keys {
			kind, err := client.Type(ctx, key).Result()
			if err != nil || kind == "none" {
				continue
			}
			if input.Type != "" && kind != input.Type {
				continue
			}
			ttl, _ := client.TTL(ctx, key).Result()
			value, err := redisPreview(ctx, client, key, kind)
			if err != nil {
				value = json.RawMessage(fmt.Sprintf("%q", "error: "+err.Error()))
			}
			entries = append(entries, RedisEntry{Key: key, Type: kind, TTL: int64(ttl / time.Second), Value: value})
			if len(entries) == input.Limit {
				break
			}
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return entries, cursor, nil
}

func redisPreview(ctx context.Context, client *goredis.Client, key, kind string) (json.RawMessage, error) {
	const capItems = 100
	switch kind {
	case "string":
		v, err := client.Get(ctx, key).Result()
		if err != nil {
			return nil, err
		}
		if len(v) > 4096 {
			v = v[:4096] + "…"
		}
		raw, _ := json.Marshal(v)
		return raw, nil
	case "hash":
		v, err := client.HGetAll(ctx, key).Result()
		if err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(v)
		return raw, nil
	case "list":
		v, err := client.LRange(ctx, key, 0, capItems-1).Result()
		if err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(v)
		return raw, nil
	case "set":
		v, err := client.SRandMemberN(ctx, key, capItems).Result()
		if err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(v)
		return raw, nil
	case "zset":
		v, err := client.ZRangeWithScores(ctx, key, 0, capItems-1).Result()
		if err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(v)
		return raw, nil
	case "stream":
		v, err := client.XRevRangeN(ctx, key, "+", "-", capItems).Result()
		if err != nil {
			return nil, err
		}
		raw, _ := json.Marshal(v)
		return raw, nil
	default:
		return json.RawMessage(fmt.Sprintf("%q", "unsupported type: "+kind)), nil
	}
}
