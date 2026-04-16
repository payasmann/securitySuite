package permissions

// Permission defines the full set of boolean capabilities for a role.
type Permission struct {
	CanAccessOpsPortal    bool
	CanAccessSchoolPortal bool
	CanManageSchools      bool
	CanViewAllSchools     bool
	CanEditFeatureFlags   bool
	CanViewCameras        bool
	CanManageCameras      bool
	CanViewLiveFeeds      bool
	CanViewAlerts         bool
	CanResolveAlerts      bool
	CanViewAllAlerts      bool
	CanManageUsers        bool
	CanManageAllUsers     bool
	CanViewDashboard      bool
	CanViewOpsDashboard   bool
}

// RolePermissions maps each role name to its complete permission set.
// Values match the TypeScript ROLE_PERMISSIONS exactly.
var RolePermissions = map[string]Permission{
	"SUPER_ADMIN": {
		CanAccessOpsPortal:    true,
		CanAccessSchoolPortal: true,
		CanManageSchools:      true,
		CanViewAllSchools:     true,
		CanEditFeatureFlags:   true,
		CanViewCameras:        true,
		CanManageCameras:      true,
		CanViewLiveFeeds:      true,
		CanViewAlerts:         true,
		CanResolveAlerts:      true,
		CanViewAllAlerts:      true,
		CanManageUsers:        true,
		CanManageAllUsers:     true,
		CanViewDashboard:      true,
		CanViewOpsDashboard:   true,
	},
	"OPS_VIEWER": {
		CanAccessOpsPortal:    true,
		CanAccessSchoolPortal: false,
		CanManageSchools:      false,
		CanViewAllSchools:     true,
		CanEditFeatureFlags:   false,
		CanViewCameras:        true,
		CanManageCameras:      false,
		CanViewLiveFeeds:      false,
		CanViewAlerts:         true,
		CanResolveAlerts:      false,
		CanViewAllAlerts:      true,
		CanManageUsers:        false,
		CanManageAllUsers:     false,
		CanViewDashboard:      false,
		CanViewOpsDashboard:   true,
	},
	"SCHOOL_ADMIN": {
		CanAccessOpsPortal:    false,
		CanAccessSchoolPortal: true,
		CanManageSchools:      false,
		CanViewAllSchools:     false,
		CanEditFeatureFlags:   false,
		CanViewCameras:        true,
		CanManageCameras:      false,
		CanViewLiveFeeds:      true,
		CanViewAlerts:         true,
		CanResolveAlerts:      true,
		CanViewAllAlerts:      false,
		CanManageUsers:        true,
		CanManageAllUsers:     false,
		CanViewDashboard:      true,
		CanViewOpsDashboard:   false,
	},
	"SCHOOL_VIEWER": {
		CanAccessOpsPortal:    false,
		CanAccessSchoolPortal: true,
		CanManageSchools:      false,
		CanViewAllSchools:     false,
		CanEditFeatureFlags:   false,
		CanViewCameras:        true,
		CanManageCameras:      false,
		CanViewLiveFeeds:      true,
		CanViewAlerts:         true,
		CanResolveAlerts:      false,
		CanViewAllAlerts:      false,
		CanManageUsers:        false,
		CanManageAllUsers:     false,
		CanViewDashboard:      true,
		CanViewOpsDashboard:   false,
	},
}

// permissionField maps a permission name string to a getter function on Permission.
var permissionField = map[string]func(Permission) bool{
	"canAccessOpsPortal":    func(p Permission) bool { return p.CanAccessOpsPortal },
	"canAccessSchoolPortal": func(p Permission) bool { return p.CanAccessSchoolPortal },
	"canManageSchools":      func(p Permission) bool { return p.CanManageSchools },
	"canViewAllSchools":     func(p Permission) bool { return p.CanViewAllSchools },
	"canEditFeatureFlags":   func(p Permission) bool { return p.CanEditFeatureFlags },
	"canViewCameras":        func(p Permission) bool { return p.CanViewCameras },
	"canManageCameras":      func(p Permission) bool { return p.CanManageCameras },
	"canViewLiveFeeds":      func(p Permission) bool { return p.CanViewLiveFeeds },
	"canViewAlerts":         func(p Permission) bool { return p.CanViewAlerts },
	"canResolveAlerts":      func(p Permission) bool { return p.CanResolveAlerts },
	"canViewAllAlerts":      func(p Permission) bool { return p.CanViewAllAlerts },
	"canManageUsers":        func(p Permission) bool { return p.CanManageUsers },
	"canManageAllUsers":     func(p Permission) bool { return p.CanManageAllUsers },
	"canViewDashboard":      func(p Permission) bool { return p.CanViewDashboard },
	"canViewOpsDashboard":   func(p Permission) bool { return p.CanViewOpsDashboard },
}

// HasPermission checks whether the given role has the named permission.
// Returns false for unknown roles or permission names.
func HasPermission(role, permission string) bool {
	perms, ok := RolePermissions[role]
	if !ok {
		return false
	}
	getter, ok := permissionField[permission]
	if !ok {
		return false
	}
	return getter(perms)
}

// IsOpsRole returns true if the role is an internal operations role.
func IsOpsRole(role string) bool {
	return role == "SUPER_ADMIN" || role == "OPS_VIEWER"
}

// IsSchoolRole returns true if the role is a school-scoped role.
func IsSchoolRole(role string) bool {
	return role == "SCHOOL_ADMIN" || role == "SCHOOL_VIEWER"
}

// CanAccessSchoolData checks whether a user with the given role and school ID
// is permitted to access data for the target school.
// Ops roles can access any school; school roles can only access their own.
func CanAccessSchoolData(role, userSchoolID, targetSchoolID string) bool {
	if IsOpsRole(role) {
		return true
	}
	return userSchoolID == targetSchoolID
}

// CanManageRole checks whether a manager with the given role can create or edit
// users with the target role.
// SUPER_ADMIN can manage any role. SCHOOL_ADMIN can manage SCHOOL_ADMIN and
// SCHOOL_VIEWER. All other roles cannot manage anyone.
func CanManageRole(managerRole, targetRole string) bool {
	if managerRole == "SUPER_ADMIN" {
		return true
	}
	if managerRole == "SCHOOL_ADMIN" {
		return targetRole == "SCHOOL_ADMIN" || targetRole == "SCHOOL_VIEWER"
	}
	return false
}

// AssignableRoles returns the list of roles that a manager with the given role
// is allowed to assign to other users.
func AssignableRoles(managerRole string) []string {
	switch managerRole {
	case "SUPER_ADMIN":
		return []string{"SUPER_ADMIN", "OPS_VIEWER", "SCHOOL_ADMIN", "SCHOOL_VIEWER"}
	case "SCHOOL_ADMIN":
		return []string{"SCHOOL_ADMIN", "SCHOOL_VIEWER"}
	default:
		return []string{}
	}
}

// GetLoginRedirect returns the default path to redirect to after login
// based on the user's role.
func GetLoginRedirect(role string) string {
	if IsOpsRole(role) {
		return "/ops/dashboard"
	}
	return "/dashboard"
}
