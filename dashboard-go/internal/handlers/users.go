package handlers

import (
	"log"
	"net/http"

	"safeguard-dashboard/internal/auth"
	"safeguard-dashboard/internal/database"
	"safeguard-dashboard/internal/middleware"
	"safeguard-dashboard/internal/permissions"
)

// ─── Response Types ─────────────────────────────────────

type userSchoolInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type userListItem struct {
	ID        string          `json:"id"`
	Email     string          `json:"email"`
	Name      string          `json:"name"`
	Role      string          `json:"role"`
	Active    bool            `json:"active"`
	CreatedAt string          `json:"createdAt"`
	School    *userSchoolInfo `json:"school,omitempty"`
}

type userCreatedItem struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Role      string `json:"role"`
	Active    bool   `json:"active"`
	CreatedAt string `json:"createdAt"`
}

// ─── GET /api/users ─────────────────────────────────────

// ListUsers returns users for the caller's scope. Ops roles see all users
// (optionally filtered by ?schoolId), school roles see only their school's users.
func (h *Handlers) ListUsers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}

	if !permissions.HasPermission(user.Role, "canManageUsers") &&
		!permissions.HasPermission(user.Role, "canManageAllUsers") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	ctx := r.Context()

	var schoolFilter *string
	if permissions.IsOpsRole(user.Role) {
		// Ops can optionally filter by schoolId.
		if qSchool := r.URL.Query().Get("schoolId"); qSchool != "" {
			schoolFilter = &qSchool
		}
	} else {
		// School roles see only their own school.
		if user.SchoolID == "" {
			writeError(w, http.StatusBadRequest, "No school context")
			return
		}
		schoolFilter = &user.SchoolID
	}

	users, err := database.ListUsers(ctx, schoolFilter, nil, 1000, 0)
	if err != nil {
		log.Printf("[Users] ListUsers error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	items := make([]userListItem, 0, len(users))
	for _, u := range users {
		item := userListItem{
			ID:        u.ID,
			Email:     u.Email,
			Name:      u.Name,
			Role:      string(u.Role),
			Active:    u.Active,
			CreatedAt: u.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		}
		// Resolve school info.
		if u.SchoolID != nil {
			school, err := database.FindSchoolByID(ctx, *u.SchoolID)
			if err == nil && school != nil {
				item.School = &userSchoolInfo{
					ID:   school.ID,
					Name: school.Name,
				}
			}
		}
		items = append(items, item)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"users":           items,
		"assignableRoles": permissions.AssignableRoles(user.Role),
	})
}

// ─── POST /api/users ────────────────────────────────────

type createUserRequest struct {
	Email    string  `json:"email"`
	Name     string  `json:"name"`
	Password string  `json:"password"`
	Role     string  `json:"role"`
	SchoolID *string `json:"schoolId,omitempty"`
}

// CreateUser creates a new user account. Requires canManageUsers permission.
// Role hierarchy is enforced via canManageRole.
func (h *Handlers) CreateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	user := middleware.GetSession(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if !permissions.HasPermission(user.Role, "canManageUsers") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	var body createUserRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	if body.Email == "" || body.Name == "" || body.Password == "" || body.Role == "" {
		writeError(w, http.StatusBadRequest, "Missing required fields: email, name, password, role")
		return
	}

	// Validate target role.
	targetRole := database.Role(body.Role)
	if !targetRole.Valid() {
		writeError(w, http.StatusBadRequest, "Invalid role")
		return
	}

	if !permissions.CanManageRole(user.Role, body.Role) {
		writeError(w, http.StatusForbidden, "Cannot create user with role "+body.Role)
		return
	}

	ctx := r.Context()

	// Determine school ID for the new user.
	var newUserSchoolID *string
	if permissions.IsSchoolRole(body.Role) {
		if permissions.IsOpsRole(user.Role) {
			newUserSchoolID = body.SchoolID
		} else {
			if user.SchoolID == "" {
				writeError(w, http.StatusBadRequest, "No school context")
				return
			}
			newUserSchoolID = &user.SchoolID
		}
		if newUserSchoolID == nil || *newUserSchoolID == "" {
			writeError(w, http.StatusBadRequest, "School ID required for school-level roles")
			return
		}

		// Check maxUsers limit.
		school, err := database.FindSchoolByID(ctx, *newUserSchoolID)
		if err != nil {
			log.Printf("[Users] FindSchoolByID error: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		if school == nil {
			writeError(w, http.StatusBadRequest, "School not found")
			return
		}

		activeCount, err := database.CountActiveUsers(ctx, *newUserSchoolID)
		if err != nil {
			log.Printf("[Users] CountActiveUsers error: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		if activeCount >= school.MaxUsers {
			writeError(w, http.StatusBadRequest,
				"Maximum user limit ("+itoa(school.MaxUsers)+") reached for this school")
			return
		}
	}

	// Check email uniqueness.
	existing, err := database.FindUserByEmail(ctx, body.Email)
	if err != nil {
		log.Printf("[Users] FindUserByEmail error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if existing != nil {
		writeError(w, http.StatusConflict, "A user with this email already exists")
		return
	}

	// Hash password with bcrypt cost 12.
	hashedPassword, err := auth.HashPassword(body.Password)
	if err != nil {
		log.Printf("[Users] HashPassword error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	newUser := &database.User{
		Email:    body.Email,
		Name:     body.Name,
		Password: hashedPassword,
		Role:     targetRole,
		SchoolID: newUserSchoolID,
	}

	created, err := database.CreateUser(ctx, newUser)
	if err != nil {
		log.Printf("[Users] CreateUser error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"user": userCreatedItem{
			ID:        created.ID,
			Email:     created.Email,
			Name:      created.Name,
			Role:      string(created.Role),
			Active:    created.Active,
			CreatedAt: created.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		},
	})
}

// ─── PATCH /api/users/{id} ──────────────────────────────

type updateUserRequest struct {
	Name   *string `json:"name,omitempty"`
	Active *bool   `json:"active,omitempty"`
	Role   *string `json:"role,omitempty"`
}

// UpdateUser updates a user's name, active status, or role.
// Requires canManageUsers permission and role hierarchy enforcement.
func (h *Handlers) UpdateUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	caller := middleware.GetSession(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if !permissions.HasPermission(caller.Role, "canManageUsers") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing user id")
		return
	}

	ctx := r.Context()

	target, err := database.FindUserByID(ctx, id)
	if err != nil {
		log.Printf("[Users] FindUserByID error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}

	// School-scoped access check.
	if !permissions.IsOpsRole(caller.Role) {
		targetSchool := ""
		if target.SchoolID != nil {
			targetSchool = *target.SchoolID
		}
		if targetSchool != caller.SchoolID {
			writeError(w, http.StatusForbidden, "Forbidden")
			return
		}
	}

	// Role hierarchy: can the caller manage the target's current role?
	if !permissions.CanManageRole(caller.Role, string(target.Role)) {
		writeError(w, http.StatusForbidden, "Cannot modify this user")
		return
	}

	var body updateUserRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Apply updates to the existing user fields.
	name := target.Name
	role := target.Role
	active := target.Active

	if body.Name != nil {
		name = *body.Name
	}
	if body.Active != nil {
		active = *body.Active
	}
	if body.Role != nil {
		if !permissions.CanManageRole(caller.Role, *body.Role) {
			writeError(w, http.StatusForbidden, "Cannot assign role "+*body.Role)
			return
		}
		newRole := database.Role(*body.Role)
		if !newRole.Valid() {
			writeError(w, http.StatusBadRequest, "Invalid role")
			return
		}
		role = newRole
	}

	// If active status changed, use SetUserActive.
	if body.Active != nil && *body.Active != target.Active {
		if err := database.SetUserActive(ctx, id, active); err != nil {
			log.Printf("[Users] SetUserActive error: %v", err)
			writeError(w, http.StatusInternalServerError, "Internal server error")
			return
		}
	}

	// Update name and role if needed.
	if err := database.UpdateUser(ctx, id, name, target.Email, role, target.SchoolID); err != nil {
		log.Printf("[Users] UpdateUser error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": userCreatedItem{
			ID:        target.ID,
			Email:     target.Email,
			Name:      name,
			Role:      string(role),
			Active:    active,
			CreatedAt: target.CreatedAt.Format("2006-01-02T15:04:05.000Z"),
		},
	})
}

// ─── DELETE /api/users/{id} ─────────────────────────────

// DeleteUser soft-deletes a user by setting active=false.
// Cannot deactivate self. Requires canManageUsers and role hierarchy.
func (h *Handlers) DeleteUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	caller := middleware.GetSession(r.Context())
	if caller == nil {
		writeError(w, http.StatusUnauthorized, "Authentication required")
		return
	}
	if !permissions.HasPermission(caller.Role, "canManageUsers") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Missing user id")
		return
	}

	// Cannot deactivate self.
	if id == caller.ID {
		writeError(w, http.StatusBadRequest, "Cannot delete your own account")
		return
	}

	ctx := r.Context()

	target, err := database.FindUserByID(ctx, id)
	if err != nil {
		log.Printf("[Users] FindUserByID error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}
	if target == nil {
		writeError(w, http.StatusNotFound, "User not found")
		return
	}

	// School-scoped access check.
	if !permissions.IsOpsRole(caller.Role) {
		targetSchool := ""
		if target.SchoolID != nil {
			targetSchool = *target.SchoolID
		}
		if targetSchool != caller.SchoolID {
			writeError(w, http.StatusForbidden, "Forbidden")
			return
		}
	}

	// Role hierarchy check.
	if !permissions.CanManageRole(caller.Role, string(target.Role)) {
		writeError(w, http.StatusForbidden, "Cannot delete this user")
		return
	}

	if err := database.DeactivateUser(ctx, id); err != nil {
		log.Printf("[Users] DeactivateUser error: %v", err)
		writeError(w, http.StatusInternalServerError, "Internal server error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "User deactivated"})
}

// ─── Helpers ────────────────────────────────────────────

// itoa converts an int to a string without importing strconv.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	if neg {
		s = "-" + s
	}
	return s
}
