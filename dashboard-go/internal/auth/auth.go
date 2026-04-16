package auth

import (
	"crypto/subtle"
	"errors"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// SessionUser represents the authenticated user stored in a JWT session.
type SessionUser struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	SchoolID string `json:"schoolId,omitempty"`
	Active   bool   `json:"active"`
}

// Custom JWT claims embedding the session user.
type sessionClaims struct {
	jwt.RegisteredClaims
	User SessionUser `json:"user"`
}

const tokenExpiry = 8 * time.Hour

var (
	ErrMissingSecret = errors.New("auth: AUTH_SECRET environment variable is not set")
	ErrInvalidToken  = errors.New("auth: invalid or expired token")
	ErrInactiveUser  = errors.New("auth: user account is inactive")
)

// signingKey returns the HMAC signing key from the environment.
func signingKey() ([]byte, error) {
	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		return nil, ErrMissingSecret
	}
	return []byte(secret), nil
}

// GenerateToken creates a signed JWT for the given user with an 8-hour expiry.
func GenerateToken(user SessionUser) (string, error) {
	key, err := signingKey()
	if err != nil {
		return "", err
	}

	now := time.Now()
	claims := sessionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenExpiry)),
			Issuer:    "safeguard-dashboard",
			Subject:   user.ID,
		},
		User: user,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(key)
}

// ValidateToken parses and validates a JWT, returning the embedded SessionUser.
func ValidateToken(tokenString string) (*SessionUser, error) {
	key, err := signingKey()
	if err != nil {
		return nil, err
	}

	token, err := jwt.ParseWithClaims(tokenString, &sessionClaims{}, func(t *jwt.Token) (any, error) {
		// Ensure the signing method is HMAC.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return key, nil
	})
	if err != nil {
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*sessionClaims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	if !claims.User.Active {
		return nil, ErrInactiveUser
	}

	return &claims.User, nil
}

// HashPassword hashes a plaintext password using bcrypt with cost 12.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

// ComparePassword checks whether a bcrypt hash matches the given plaintext password.
func ComparePassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// TimingSafeCompare performs a constant-time comparison of two strings to
// prevent timing side-channel attacks.
func TimingSafeCompare(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
