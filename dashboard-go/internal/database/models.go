package database

import (
	"database/sql/driver"
	"fmt"
	"time"
)

// ─── Enums ────────────────────────────────────────────────

type Role string

const (
	RoleSuperAdmin   Role = "SUPER_ADMIN"
	RoleOpsViewer    Role = "OPS_VIEWER"
	RoleSchoolAdmin  Role = "SCHOOL_ADMIN"
	RoleSchoolViewer Role = "SCHOOL_VIEWER"
)

func (r Role) Valid() bool {
	switch r {
	case RoleSuperAdmin, RoleOpsViewer, RoleSchoolAdmin, RoleSchoolViewer:
		return true
	}
	return false
}

func (r Role) Value() (driver.Value, error) { return string(r), nil }

func (r *Role) Scan(src any) error {
	s, ok := src.(string)
	if !ok {
		return fmt.Errorf("Role.Scan: expected string, got %T", src)
	}
	*r = Role(s)
	if !r.Valid() {
		return fmt.Errorf("Role.Scan: invalid value %q", s)
	}
	return nil
}

type CameraStatus string

const (
	CameraStatusOnline  CameraStatus = "ONLINE"
	CameraStatusOffline CameraStatus = "OFFLINE"
	CameraStatusWarning CameraStatus = "WARNING"
)

func (c CameraStatus) Valid() bool {
	switch c {
	case CameraStatusOnline, CameraStatusOffline, CameraStatusWarning:
		return true
	}
	return false
}

func (c CameraStatus) Value() (driver.Value, error) { return string(c), nil }

func (c *CameraStatus) Scan(src any) error {
	s, ok := src.(string)
	if !ok {
		return fmt.Errorf("CameraStatus.Scan: expected string, got %T", src)
	}
	*c = CameraStatus(s)
	if !c.Valid() {
		return fmt.Errorf("CameraStatus.Scan: invalid value %q", s)
	}
	return nil
}

type AlertType string

const (
	AlertTypeCritical AlertType = "CRITICAL"
	AlertTypeWarning  AlertType = "WARNING"
	AlertTypeInfo     AlertType = "INFO"
)

func (a AlertType) Valid() bool {
	switch a {
	case AlertTypeCritical, AlertTypeWarning, AlertTypeInfo:
		return true
	}
	return false
}

func (a AlertType) Value() (driver.Value, error) { return string(a), nil }

func (a *AlertType) Scan(src any) error {
	s, ok := src.(string)
	if !ok {
		return fmt.Errorf("AlertType.Scan: expected string, got %T", src)
	}
	*a = AlertType(s)
	if !a.Valid() {
		return fmt.Errorf("AlertType.Scan: invalid value %q", s)
	}
	return nil
}

// ─── Models ───────────────────────────────────────────────

type School struct {
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Slug      string    `json:"slug" db:"slug"`
	Address   *string   `json:"address,omitempty" db:"address"`
	IPRange   *string   `json:"ipRange,omitempty" db:"ip_range"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`

	// Feature flags
	LocalStorageEnabled bool `json:"localStorageEnabled" db:"local_storage_enabled"`
	CloudStorageEnabled bool `json:"cloudStorageEnabled" db:"cloud_storage_enabled"`
	RemoteAccessEnabled bool `json:"remoteAccessEnabled" db:"remote_access_enabled"`
	LocalViewEnabled    bool `json:"localViewEnabled" db:"local_view_enabled"`

	// Limits
	RetentionDays int `json:"retentionDays" db:"retention_days"`
	MaxCameras    int `json:"maxCameras" db:"max_cameras"`
	MaxUsers      int `json:"maxUsers" db:"max_users"`
}

// SchoolWithStats extends School with computed aggregate fields for list views.
type SchoolWithStats struct {
	School
	CameraCount       int `json:"cameraCount" db:"camera_count"`
	OnlineCameraCount int `json:"onlineCameraCount" db:"online_camera_count"`
	UserCount         int `json:"userCount" db:"user_count"`
	AlertCount        int `json:"alertCount" db:"alert_count"`
}

// SchoolFlags is a lightweight projection containing only feature-flag columns.
type SchoolFlags struct {
	LocalStorageEnabled bool `json:"localStorageEnabled" db:"local_storage_enabled"`
	CloudStorageEnabled bool `json:"cloudStorageEnabled" db:"cloud_storage_enabled"`
	RemoteAccessEnabled bool `json:"remoteAccessEnabled" db:"remote_access_enabled"`
	LocalViewEnabled    bool `json:"localViewEnabled" db:"local_view_enabled"`
}

type User struct {
	ID        string    `json:"id" db:"id"`
	Email     string    `json:"email" db:"email"`
	Name      string    `json:"name" db:"name"`
	Password  string    `json:"-" db:"password"` // never serialize
	Role      Role      `json:"role" db:"role"`
	Active    bool      `json:"active" db:"active"`
	SchoolID  *string   `json:"schoolId,omitempty" db:"school_id"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

type Camera struct {
	ID         string       `json:"id" db:"id"`
	CameraID   string       `json:"cameraId" db:"camera_id"`
	Name       string       `json:"name" db:"name"`
	Zone       string       `json:"zone" db:"zone"`
	Type       string       `json:"type" db:"type"`
	Resolution string       `json:"resolution" db:"resolution"`
	RtspURL    string       `json:"-" db:"rtsp_url"` // never expose to client
	Status     CameraStatus `json:"status" db:"status"`
	LastSeenAt *time.Time   `json:"lastSeenAt,omitempty" db:"last_seen_at"`
	SchoolID   string       `json:"schoolId" db:"school_id"`
	CreatedAt  time.Time    `json:"createdAt" db:"created_at"`
	UpdatedAt  time.Time    `json:"updatedAt" db:"updated_at"`
}

type Alert struct {
	ID        string    `json:"id" db:"id"`
	Type      AlertType `json:"type" db:"type"`
	Title     string    `json:"title" db:"title"`
	Detail    *string   `json:"detail,omitempty" db:"detail"`
	Resolved  bool      `json:"resolved" db:"resolved"`
	CameraID  *string   `json:"cameraId,omitempty" db:"camera_id"`
	SchoolID  string    `json:"schoolId" db:"school_id"`
	CreatedAt time.Time `json:"createdAt" db:"created_at"`
	UpdatedAt time.Time `json:"updatedAt" db:"updated_at"`
}

type MotionEvent struct {
	ID         string    `json:"id" db:"id"`
	Count      int       `json:"count" db:"count"`
	CameraID   string    `json:"cameraId" db:"camera_id"`
	SchoolID   string    `json:"schoolId" db:"school_id"`
	RecordedAt time.Time `json:"recordedAt" db:"recorded_at"`
}

type StreamBridge struct {
	ID          string     `json:"id" db:"id"`
	SchoolID    string     `json:"schoolId" db:"school_id"`
	InternalURL string     `json:"internalUrl" db:"internal_url"`
	PublicURL   *string    `json:"publicUrl,omitempty" db:"public_url"`
	APIKey      string     `json:"-" db:"api_key"` // never serialize
	LastPingAt  *time.Time `json:"lastPingAt,omitempty" db:"last_ping_at"`
	Online      bool       `json:"online" db:"online"`
	CreatedAt   time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt   time.Time  `json:"updatedAt" db:"updated_at"`
}

// ─── Query helpers ────────────────────────────────────────

// MotionAggregate is used for time-series aggregation results.
type MotionAggregate struct {
	Bucket time.Time `json:"bucket" db:"bucket"`
	Total  int       `json:"total" db:"total"`
}

// MotionByCamera groups motion counts per camera.
type MotionByCamera struct {
	CameraID string `json:"cameraId" db:"camera_id"`
	Name     string `json:"name" db:"name"`
	Total    int    `json:"total" db:"total"`
}

// AlertListParams holds filter + pagination for alert listing.
type AlertListParams struct {
	SchoolID string
	Type     *AlertType
	Resolved *bool
	Limit    int
	Offset   int
}
