package api

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testClientPair(t *testing.T) (certPEM, keyPEM string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{SerialNumber: big.NewInt(7), Subject: pkix.Name{CommonName: "client"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, _ := x509.MarshalPKCS8PrivateKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})), string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}))
}

func TestTLSClientKeyIsEncryptedReplacedAndRemoved(t *testing.T) {
	s, identity := personalServer(t)
	ctx := context.Background()
	certPEM, keyPEM := testClientPair(t)
	_, otherKeyPEM := testClientPair(t)
	call := func(handler http.HandlerFunc, connectionID string, body map[string]any) *httptest.ResponseRecorder {
		t.Helper()
		encoded, _ := json.Marshal(body)
		r := httptest.NewRequest("POST", "/", bytes.NewReader(encoded)).WithContext(context.WithValue(ctx, contextKey{}, identity))
		r.SetPathValue("id", connectionID)
		w := httptest.NewRecorder()
		handler(w, r)
		return w
	}
	fields := func(extra map[string]any) map[string]any {
		body := map[string]any{"name": "tls", "engine": "postgres", "host": "db", "port": 5432, "connectionUsername": "user", "password": "secret", "tlsMode": "verify-full"}
		for key, value := range extra {
			body[key] = value
		}
		return body
	}
	secretRows := func() int {
		t.Helper()
		var count int
		if err := s.store.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM secrets").Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count
	}

	if w := call(s.createConnection, "", fields(map[string]any{"tlsClientCertPem": certPEM})); w.Code != 400 || !strings.Contains(w.Body.String(), "together") {
		t.Fatalf("certificate without key: %d %s", w.Code, w.Body.String())
	}
	created := call(s.createConnection, "", fields(map[string]any{"tlsClientCertPem": certPEM, "tlsClientKey": keyPEM}))
	var response struct {
		ID                     string
		TLSMode                string `json:"tlsMode"`
		TLSClientKeyConfigured bool   `json:"tlsClientKeyConfigured"`
	}
	if created.Code != 201 || json.Unmarshal(created.Body.Bytes(), &response) != nil || !response.TLSClientKeyConfigured || response.TLSMode != "verify-full" {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	if strings.Contains(created.Body.String(), "PRIVATE KEY") {
		t.Fatal("response exposed the private key")
	}
	stored, err := s.store.Connection(ctx, response.ID)
	if err != nil || stored.TLSClientKeySecret == "" {
		t.Fatalf("stored connection: %#v %v", stored, err)
	}
	target, err := s.engineConnectionAt(ctx, stored, "", stored.Host, stored.Port)
	if err != nil || target.TLS.ClientKeyPEM != strings.TrimSpace(keyPEM) || target.TLS.ClientCertPEM != strings.TrimSpace(certPEM) || target.TLS.Mode != "verify-full" {
		t.Fatalf("engine TLS settings: %#v %v", target.TLS, err)
	}
	if rows := secretRows(); rows != 2 {
		t.Fatalf("password and client-key secrets must both be stored, got %d", rows)
	}

	if w := call(s.updateConnection, response.ID, fields(map[string]any{"tlsClientKey": otherKeyPEM})); w.Code != 400 || !strings.Contains(w.Body.String(), "valid pair") {
		t.Fatalf("mismatched key accepted: %d %s", w.Code, w.Body.String())
	}
	if w := call(s.updateConnection, response.ID, fields(map[string]any{"tlsServerName": "db.internal"})); w.Code != 200 {
		t.Fatalf("update keeping key: %d %s", w.Code, w.Body.String())
	}
	if kept, _ := s.store.Connection(ctx, response.ID); kept.TLSClientKeySecret != stored.TLSClientKeySecret || kept.TLSServerName != "db.internal" {
		t.Fatalf("omitted key was not kept: %#v", kept)
	}
	if w := call(s.updateConnection, response.ID, fields(map[string]any{"tlsClientKey": ""})); w.Code != 400 {
		t.Fatalf("removing key but keeping certificate: %d %s", w.Code, w.Body.String())
	}
	if w := call(s.updateConnection, response.ID, fields(map[string]any{"tlsClientKey": "", "tlsClientCertPem": ""})); w.Code != 200 {
		t.Fatalf("remove client identity: %d %s", w.Code, w.Body.String())
	}
	if removed, _ := s.store.Connection(ctx, response.ID); removed.TLSClientKeySecret != "" || removed.TLSClientCertPEM != "" {
		t.Fatalf("client identity not removed: %#v", removed)
	}
	if rows := secretRows(); rows != 1 {
		t.Fatalf("removed client key secret was left behind: %d secrets", rows)
	}
}
