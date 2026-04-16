package middleware

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"runtime/debug"
	"strings"
	"time"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/permissions"
)

// ─── Context Keys ───────────────────────────────────────

// contextKey is an unexported type to prevent collisions with keys defined in
// other packages.
type contextKey int

const (
	sessionKey contextKey = iota
)

// GetSession extracts the authenticated SessionUser from the request context.
// Returns nil if no session is present.
func GetSession(ctx context.Context) *auth.SessionUser {
	user, _ := ctx.Value(sessionKey).(*auth.SessionUser)
	return user
}

// SetSession stores a SessionUser in the context.
func SetSession(ctx context.Context, user *auth.SessionUser) context.Context {
	return context.WithValue(ctx, sessionKey, user)
}

// ─── Auth Middleware ─────────────────────────────────────

// AuthMiddleware attempts to extract and validate the session from the request
// cookie. If a valid session exists it is placed into the request context. If
// the cookie is missing or the token is invalid the request continues without a
// session — downstream handlers can decide whether to reject it.
func AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, err := auth.GetSessionFromRequest(r)
		if err == nil && user != nil {
			ctx := SetSession(r.Context(), user)
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAuth rejects the request with 401 Unauthorized if the context does not
// contain a valid session (i.e. AuthMiddleware did not find one).
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetSession(r.Context())
		if user == nil {
			writeJSON(w, http.StatusUnauthorized, errorBody("Authentication required"))
			return
		}
		if !user.Active {
			writeJSON(w, http.StatusForbidden, errorBody("Account is inactive"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireRole returns middleware that rejects the request with 403 Forbidden
// unless the authenticated user's role matches one of the given roles.
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := GetSession(r.Context())
			if user == nil {
				writeJSON(w, http.StatusUnauthorized, errorBody("Authentication required"))
				return
			}
			if !allowed[user.Role] {
				writeJSON(w, http.StatusForbidden, errorBody("Insufficient role"))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequirePermission returns middleware that rejects the request with 403
// Forbidden unless the authenticated user's role has the named RBAC permission
// (as defined in the permissions package).
func RequirePermission(perm string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user := GetSession(r.Context())
			if user == nil {
				writeJSON(w, http.StatusUnauthorized, errorBody("Authentication required"))
				return
			}
			if !permissions.HasPermission(user.Role, perm) {
				writeJSON(w, http.StatusForbidden, errorBody("Missing permission: "+perm))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// ─── CORS ───────────────────────────────────────────────

// CORS adds Cross-Origin Resource Sharing headers to every response and handles
// preflight OPTIONS requests.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = allowedOrigin()
		}

		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Authorization, Content-Type, X-CSRF-Token")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400")

		// Short-circuit preflight requests.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// allowedOrigin returns the configured origin or a sensible default.
func allowedOrigin() string {
	if origin := os.Getenv("CORS_ORIGIN"); origin != "" {
		return origin
	}
	if origin := os.Getenv("NEXTAUTH_URL"); origin != "" {
		return origin
	}
	return "http://localhost:3000"
}

// ─── Logger ─────────────────────────────────────────────

// responseRecorder wraps http.ResponseWriter to capture the status code.
type responseRecorder struct {
	http.ResponseWriter
	statusCode int
}

func (rr *responseRecorder) WriteHeader(code int) {
	rr.statusCode = code
	rr.ResponseWriter.WriteHeader(code)
}

// Logger logs every HTTP request with method, path, status, and duration.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rr := &responseRecorder{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(rr, r)

		duration := time.Since(start)

		// Determine user identifier for the log line.
		userID := "-"
		if user := GetSession(r.Context()); user != nil {
			userID = user.ID
		}

		log.Printf("[HTTP] %s %s %d %s user=%s",
			r.Method,
			r.URL.Path,
			rr.statusCode,
			duration.Round(time.Microsecond),
			userID,
		)
	})
}

// ─── Recovery ───────────────────────────────────────────

// Recovery catches panics in downstream handlers, logs the stack trace, and
// returns a 500 Internal Server Error response.
func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("[PANIC] %s %s: %v\n%s", r.Method, r.URL.Path, rec, debug.Stack())
				writeJSON(w, http.StatusInternalServerError, errorBody("Internal server error"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ─── Chain Helper ───────────────────────────────────────

// Chain composes multiple middleware into a single wrapper, applying them in
// left-to-right order (outermost first).
//
//	Chain(Logger, Recovery, CORS, AuthMiddleware)(handler)
func Chain(middlewares ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(final http.Handler) http.Handler {
		for i := len(middlewares) - 1; i >= 0; i-- {
			final = middlewares[i](final)
		}
		return final
	}
}

// ─── JSON Helpers ───────────────────────────────────────

// errorResponse is the standard JSON error body.
type errorResponse struct {
	Error string `json:"error"`
}

func errorBody(msg string) errorResponse {
	return errorResponse{Error: msg}
}

// writeJSON marshals v to JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("[HTTP] Failed to write JSON response: %v", err)
	}
}

// ─── Convenience Extractors ─────────────────────────────

// MustGetSession is like GetSession but panics if no session is found. Only use
// this after RequireAuth has already validated the session.
func MustGetSession(ctx context.Context) *auth.SessionUser {
	user := GetSession(ctx)
	if user == nil {
		panic("middleware: MustGetSession called without authenticated session")
	}
	return user
}

// HasRole returns true if the current session user has any of the given roles.
// Returns false if there is no session.
func HasRole(ctx context.Context, roles ...string) bool {
	user := GetSession(ctx)
	if user == nil {
		return false
	}
	for _, role := range roles {
		if strings.EqualFold(user.Role, role) {
			return true
		}
	}
	return false
}
