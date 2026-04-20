package handlers

import (
	"log"
	"net/http"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/permissions"
)

// ─── Request / Response Types ───────────────────────────

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type loginUserResponse struct {
	ID       string  `json:"id"`
	Email    string  `json:"email"`
	Name     string  `json:"name"`
	Role     string  `json:"role"`
	SchoolID *string `json:"schoolId,omitempty"`
}

type loginResponse struct {
	User     loginUserResponse `json:"user"`
	Redirect string            `json:"redirect"`
}

// ─── POST /api/auth/login ───────────────────────────────

// Login authenticates a user with email/password, generates a JWT token,
// sets a session cookie, and returns user info with a redirect path.
func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	var body loginRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.Email == "" || body.Password == "" {
		writeError(w, http.StatusBadRequest, "Email and password are required")
		return
	}

	ctx := r.Context()

	// Find user by email.
	user, err := database.FindUserByEmail(ctx, body.Email)
	if err != nil {
		log.Printf("[Auth] FindUserByEmail error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Invalid email or password")
		return
	}

	// Check active status.
	if !user.Active {
		writeError(w, http.StatusForbidden, "Account is inactive")
		return
	}

	// Compare bcrypt password.
	if !auth.ComparePassword(user.Password, body.Password) {
		writeError(w, http.StatusUnauthorized, "Invalid email or password")
		return
	}

	// Build session user.
	schoolID := ""
	if user.SchoolID != nil {
		schoolID = *user.SchoolID
	}

	sessionUser := auth.SessionUser{
		ID:       user.ID,
		Email:    user.Email,
		Name:     user.Name,
		Role:     string(user.Role),
		SchoolID: schoolID,
		Active:   user.Active,
	}

	// Generate JWT token.
	token, err := auth.GenerateToken(sessionUser)
	if err != nil {
		log.Printf("[Auth] GenerateToken error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	// Set session cookie.
	auth.SetSessionCookie(w, token)

	// Determine redirect path based on role.
	redirect := permissions.GetLoginRedirect(string(user.Role))

	writeJSON(w, http.StatusOK, loginResponse{
		User: loginUserResponse{
			ID:       user.ID,
			Email:    user.Email,
			Name:     user.Name,
			Role:     string(user.Role),
			SchoolID: user.SchoolID,
		},
		Redirect: redirect,
	})
}

// ─── POST /api/auth/logout ──────────────────────────────

// Logout clears the session cookie and returns 200.
func (h *Handlers) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	auth.ClearSessionCookie(w)

	writeJSON(w, http.StatusOK, map[string]string{"message": "Logged out"})
}
