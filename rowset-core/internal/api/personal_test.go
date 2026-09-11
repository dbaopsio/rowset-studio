package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dbaopsio/rowset-studio/rowset-core/internal/activity"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/auth"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/config"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/domain"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/engine"
	"github.com/dbaopsio/rowset-studio/rowset-core/internal/store"
)

func personalServer(t *testing.T) (*Server, domain.Identity) {
	t.Helper()
	ctx := context.Background()
	data, err := store.Open(ctx, filepath.Join(t.TempDir(), "personal.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { data.Close() })
	if err := data.ClaimMode(ctx, false); err != nil {
		t.Fatal(err)
	}
	identity := domain.Identity{OrgID: "org", UserID: "owner", Role: "admin", Email: "owner@example.com"}
	if err := data.CreateOrganizationWithAdmin(ctx,
		domain.Organization{ID: "org", Name: "Personal", CreatedAt: store.NowString()},
		domain.Role{ID: "admin", OrgID: "org", Name: "admin"},
		domain.User{ID: "owner", OrgID: "org", Email: identity.Email, PasswordHash: "unused", Status: "active", CreatedAt: store.NowString()},
	); err != nil {
		t.Fatal(err)
	}
	s := New(config.Config{RequestBodyLimitBytes: 1 << 20, EncryptionKey: bytes.Repeat([]byte{9}, 32)}, data, auth.NewIssuer(strings.Repeat("s", 32), ""), nil)
	t.Cleanup(func() { s.Close() })
	return s, identity
}

func personalRequest(identity domain.Identity, body string) *http.Request {
	r := httptest.NewRequest("POST", "/api/policies/custom", strings.NewReader(body))
	return r.WithContext(context.WithValue(r.Context(), contextKey{}, identity))
}

func TestInstanceReportsPersonalMode(t *testing.T) {
	s, _ := personalServer(t)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, httptest.NewRequest("GET", "/api/meta/instance", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"mode":"personal"`) {
		t.Fatal(w.Body.String())
	}
}

func TestPersonalPoliciesCanBeCreatedAndEnforceAgainstOwner(t *testing.T) {
	s, identity := personalServer(t)
	w := httptest.NewRecorder()
	s.createCustomPolicy(w, personalRequest(identity, `{"name":"scoped","kind":"deny_table","config":"customers","role":"admin"}`))
	if w.Code != 403 {
		t.Fatalf("role-scoped policy accepted: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.createCustomPolicy(w, personalRequest(identity, `{"name":"Protect customers","kind":"deny_table","config":"customers"}`))
	if w.Code != 201 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	// Blocking happens before a database connection is opened, including the
	// same executor used by transactionQuery.
	for _, txn := range []*engine.Transaction{nil, {}} {
		w = httptest.NewRecorder()
		s.executeQuery(w, personalRequest(identity, `{}`), domain.Connection{ID: "c", OrgID: "org"}, queryInput{SQL: "UPDATE customers SET name='x' WHERE id=1"}, txn)
		if w.Code != 403 || !strings.Contains(w.Body.String(), "Protect customers") {
			t.Fatalf("owner policy bypass: %d %s", w.Code, w.Body.String())
		}
	}
	items, err := activity.SQLite{Data: s.store}.ListQueryHistory(context.Background(), identity.UserID, "c", nil, nil)
	if err != nil || len(items) != 2 {
		t.Fatalf("local history: %d %v", len(items), err)
	}
	w = httptest.NewRecorder()
	s.listPolicies(w, personalRequest(identity, `{}`))
	if !strings.Contains(w.Body.String(), "deny_delete_without_where") {
		t.Fatal(w.Body.String())
	}
}

func TestDesktopOwnerChoosesPasswordThenSignsInWithItAlone(t *testing.T) {
	s, identity := personalServer(t)
	s.config.LocalOwnerEmail = identity.Email
	ctx := context.WithValue(context.Background(), contextKey{}, identity)
	if err := s.store.RequirePassword(ctx, identity.UserID); err != nil {
		t.Fatal(err)
	}
	me := func() string {
		w := httptest.NewRecorder()
		s.me(w, httptest.NewRequest("GET", "/api/auth/me", nil).WithContext(ctx))
		return w.Body.String()
	}
	if body := me(); !strings.Contains(body, `"passwordRequired":true`) {
		t.Fatal(body)
	}
	set := httptest.NewRequest("PATCH", "/", strings.NewReader(`{"password":"a-chosen-password"}`)).WithContext(ctx)
	set.SetPathValue("id", identity.UserID)
	w := httptest.NewRecorder()
	s.setUserPassword(w, set)
	if w.Code != 204 {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if body := me(); !strings.Contains(body, `"passwordRequired":false`) {
		t.Fatal(body)
	}
	w = httptest.NewRecorder()
	s.login(w, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"password":"a-chosen-password"}`)))
	if w.Code != 200 {
		t.Fatalf("password-only sign-in: %d %s", w.Code, w.Body.String())
	}
	w = httptest.NewRecorder()
	s.login(w, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"password":"wrong-password"}`)))
	if w.Code != 401 {
		t.Fatalf("wrong password accepted: %d", w.Code)
	}
}
