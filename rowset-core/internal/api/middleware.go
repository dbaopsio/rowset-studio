package api

import (
	"compress/gzip"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

const (
	apiCSP    = "default-src 'none'; frame-ancestors 'none'"
	studioCSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
)

type rateWindow struct {
	started time.Time
	count   uint32
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		s.setSecurityHeaders(w, r.URL.Path)
		if s.handleCORS(w, r) {
			return
		}
		// Static assets and authenticated API traffic must not share one IP
		// bucket. Besides making a single Studio page load surprisingly costly,
		// an IP-only API limiter combines every user behind the same reverse
		// proxy. Authenticated routes apply the same bound per verified user in
		// authenticated(); this outer bucket protects only public API traffic.
		if anonymousAPIRateLimitApplies(r) && !s.allowRequest(r) {
			writeRateLimited(w)
			return
		}
		limit := s.bodyLimit()
		if r.ContentLength > limit {
			writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", fmt.Sprintf("request body is larger than the %d MB limit", limit>>20))
			return
		}
		if limit > 0 {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		handler := next
		if !isQueryExecutionPath(r.URL.Path) {
			handler = http.TimeoutHandler(handler, 60*time.Second, `{"error":{"code":"REQUEST_TIMEOUT","message":"request exceeded the maximum duration"}}`)
		}
		writer := http.ResponseWriter(w)
		var gz *gzip.Writer
		if r.Method != http.MethodHead && strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			w.Header().Set("Content-Encoding", "gzip")
			w.Header().Add("Vary", "Accept-Encoding")
			gz = gzip.NewWriter(w)
			defer gz.Close()
			writer = gzipResponseWriter{ResponseWriter: w, gzipWriter: gz}
		}
		handler.ServeHTTP(writer, r)
		s.logger.Debug("http request", "method", r.Method, "path", r.URL.Path, "latency_ms", time.Since(started).Milliseconds())
	})
}

func (s *Server) setSecurityHeaders(w http.ResponseWriter, path string) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Strict-Transport-Security", "max-age=31536000")
	if isAPIPath(path) {
		w.Header().Set("Content-Security-Policy", apiCSP)
	} else {
		w.Header().Set("Content-Security-Policy", studioCSP)
	}
}

func (s *Server) handleCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := strings.TrimSuffix(strings.TrimSpace(s.config.StudioOrigin), "/")
	requestOrigin := strings.TrimSuffix(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin == "" || requestOrigin != origin {
		return false
	}
	w.Header().Set("Access-Control-Allow-Origin", requestOrigin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Add("Vary", "Origin")
	if r.Method != http.MethodOptions {
		return false
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.WriteHeader(http.StatusNoContent)
	return true
}

func (s *Server) allowRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if host == "" {
		host = "unknown"
	}
	return s.allowRateKey("ip:" + host)
}

func (s *Server) allowIdentity(userID string) bool {
	// A personal workspace has one signed-in owner; limiting them only makes
	// a busy editor (autosave, schema loads, long scripts) fail at random.
	if !s.config.Shared {
		return true
	}
	return s.allowRateKey("user:" + userID)
}

func (s *Server) allowRateKey(key string) bool {
	limit := s.config.RateLimitPerMinute
	if limit == 0 {
		return true
	}
	now := time.Now()
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	window := s.rateClients[key]
	if window == nil || now.Sub(window.started) >= time.Minute {
		if window == nil && len(s.rateClients) >= 10_000 {
			for key, item := range s.rateClients {
				if now.Sub(item.started) >= 2*time.Minute {
					delete(s.rateClients, key)
				}
			}
			if len(s.rateClients) >= 10_000 {
				return false
			}
		}
		s.rateClients[key] = &rateWindow{started: now, count: 1}
		return true
	}
	window.count++
	return window.count <= limit
}

func anonymousAPIRateLimitApplies(r *http.Request) bool {
	if !strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	return !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ")
}

func writeRateLimited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "60")
	writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests")
}

func isAPIPath(path string) bool {
	return strings.HasPrefix(path, "/api/") || path == "/healthz" || path == "/readyz"
}

// isQueryExecutionPath reports routes whose work takes as long as the
// database needs: queries, exports, imports, plans, schema reads and
// restores. They are exempt from the 60-second request timeout, which would
// otherwise cut them off and buffer whole downloads in memory.
func isQueryExecutionPath(path string) bool {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || parts[0] != "api" {
		return false
	}
	switch {
	// A script on several connections streams its progress for as long as
	// its statements run, and an assistant run on this computer can take
	// minutes to answer.
	case len(parts) == 2:
		return parts[1] == "multirun"
	case parts[1] == "ai" && len(parts) == 3:
		return parts[2] == "ask"
	case parts[1] == "connections" && len(parts) == 4:
		return parts[3] == "query" || parts[3] == "export" || parts[3] == "explain" || parts[3] == "schema"
	case parts[1] == "connections" && len(parts) == 6:
		return parts[3] == "txn" && parts[5] == "query" || parts[3] == "imports" && parts[5] == "run"
	case parts[1] == "connections" && len(parts) == 5:
		return parts[3] == "imports" || parts[3] == "documents" && parts[4] == "find"
	case parts[1] == "row-backups" && len(parts) == 4:
		return parts[3] == "apply"
	}
	return false
}

// bodyLimit caps request bodies. A personal workspace pastes long scripts,
// so it allows at least 32 MB.
func (s *Server) bodyLimit() int64 {
	if limit := s.config.RequestBodyLimitBytes; s.config.Shared || limit >= 32<<20 {
		return limit
	}
	return 32 << 20
}

type gzipResponseWriter struct {
	http.ResponseWriter
	gzipWriter *gzip.Writer
}

func (w gzipResponseWriter) WriteHeader(status int) {
	w.Header().Del("Content-Length")
	w.ResponseWriter.WriteHeader(status)
}

func (w gzipResponseWriter) Write(data []byte) (int, error) {
	w.Header().Del("Content-Length")
	return w.gzipWriter.Write(data)
}

func (w gzipResponseWriter) Flush() {
	_ = w.gzipWriter.Flush()
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}
