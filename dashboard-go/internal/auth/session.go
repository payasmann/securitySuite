package auth

import (
	"errors"
	"net/http"
)

const (
	sessionCookieName = "safeguard-session"
	sessionMaxAge     = 8 * 60 * 60 // 8 hours in seconds
)

var (
	ErrNoSessionCookie = errors.New("auth: no session cookie present")
)

// SetSessionCookie writes the JWT token as an HTTP-only secure cookie.
func SetSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   sessionMaxAge,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// GetSessionFromRequest extracts and validates the session user from the
// request's session cookie.
func GetSessionFromRequest(r *http.Request) (*SessionUser, error) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil, ErrNoSessionCookie
	}

	if cookie.Value == "" {
		return nil, ErrNoSessionCookie
	}

	user, err := ValidateToken(cookie.Value)
	if err != nil {
		return nil, err
	}

	return user, nil
}

// ClearSessionCookie removes the session cookie by setting MaxAge to -1.
func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}
