package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopLaunchTicketsAreAuthenticatedSingleUseAndOriginBound(t *testing.T) {
	s, identity := personalServer(t)
	s.config.LocalLauncherKey = strings.Repeat("k", 64)
	s.config.LocalOwnerEmail = identity.Email
	handler := s.Handler()
	open := func(key, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "http://127.0.0.1:18765/api/local/open", nil)
		r.Header.Set("Authorization", "Bearer "+key)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := open("wrong", ""); w.Code != 403 {
		t.Fatal(w.Code)
	}
	if w := open(s.config.LocalLauncherKey, "https://evil.example"); w.Code != 403 {
		t.Fatal(w.Code)
	}
	w := open(s.config.LocalLauncherKey, "")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &ticket); err != nil {
		t.Fatal(err)
	}
	login := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "http://127.0.0.1:18765/api/auth/local", strings.NewReader(`{"ticket":"`+ticket.Ticket+`"}`))
		r.Header.Set("Origin", "http://127.0.0.1:18765")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if w := login(); w.Code != 200 || !strings.Contains(w.Body.String(), "accessToken") {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := login(); w.Code != 401 {
		t.Fatal("replayed ticket accepted", w.Code)
	}
}
