package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlerDoesNotServeSPAForMissingAssets(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/assets/removed-release-chunk.js", nil)
	response := httptest.NewRecorder()

	Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNotFound {
		t.Fatalf("missing asset status = %d, want %d", response.Code, http.StatusNotFound)
	}
}

func TestHandlerServesSPAForClientRoute(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/notebooks", nil)
	response := httptest.NewRecorder()

	Handler().ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("client route status = %d, want %d", response.Code, http.StatusOK)
	}
}
