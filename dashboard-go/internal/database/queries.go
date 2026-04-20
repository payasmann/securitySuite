package database

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lucsky/cuid"
)

// pool returns the package-level Pool, panicking if it was never initialised.
// Every exported query function calls this so callers get an obvious error
// rather than a nil-pointer dereference.
func pool() *pgxpool.Pool {
	if Pool == nil {
		panic("database: Pool is nil — call NewPool before executing queries")
	}
	return Pool
}

// ─── StreamBridge ─────────────────────────────────────────

// FindStreamBridgeBySchoolID returns the stream bridge for the given school.
func FindStreamBridgeBySchoolID(ctx context.Context, schoolID string) (*StreamBridge, error) {
	const q = `
		SELECT id, school_id, internal_url, public_url, api_key,
		       last_ping_at, online, created_at, updated_at
		FROM "StreamBridge"
		WHERE school_id = $1`

	var sb StreamBridge
	err := pool().QueryRow(ctx, q, schoolID).Scan(
		&sb.ID, &sb.SchoolID, &sb.InternalURL, &sb.PublicURL, &sb.APIKey,
		&sb.LastPingAt, &sb.Online, &sb.CreatedAt, &sb.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindStreamBridgeBySchoolID: %w", err)
	}
	return &sb, nil
}

// UpdateStreamBridge updates mutable fields on a stream bridge row.
func UpdateStreamBridge(ctx context.Context, id string, internalURL string, publicURL *string, online bool, lastPingAt *time.Time) error {
	const q = `
		UPDATE "StreamBridge"
		SET internal_url = $2, public_url = $3, online = $4,
		    last_ping_at = $5, updated_at = NOW()
		WHERE id = $1`

	_, err := pool().Exec(ctx, q, id, internalURL, publicURL, online, lastPingAt)
	if err != nil {
		return fmt.Errorf("UpdateStreamBridge: %w", err)
	}
	return nil
}

// ─── Camera ───────────────────────────────────────────────

func scanCamera(row pgx.Row) (*Camera, error) {
	var c Camera
	err := row.Scan(
		&c.ID, &c.CameraID, &c.Name, &c.Zone, &c.Type, &c.Resolution,
		&c.RtspURL, &c.Status, &c.LastSeenAt, &c.SchoolID,
		&c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

const cameraColumns = `id, camera_id, name, zone, type, resolution,
		rtsp_url, status, last_seen_at, school_id, created_at, updated_at`

// FindCameraBySchoolAndCameraID looks up a camera by its school-scoped display ID.
func FindCameraBySchoolAndCameraID(ctx context.Context, schoolID, cameraID string) (*Camera, error) {
	q := fmt.Sprintf(`SELECT %s FROM "Camera" WHERE school_id = $1 AND camera_id = $2`, cameraColumns)

	c, err := scanCamera(pool().QueryRow(ctx, q, schoolID, cameraID))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindCameraBySchoolAndCameraID: %w", err)
	}
	return c, nil
}

// FindCameraByID looks up a camera by primary key.
func FindCameraByID(ctx context.Context, id string) (*Camera, error) {
	q := fmt.Sprintf(`SELECT %s FROM "Camera" WHERE id = $1`, cameraColumns)

	c, err := scanCamera(pool().QueryRow(ctx, q, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindCameraByID: %w", err)
	}
	return c, nil
}

// UpdateCameraStatus updates a camera's status and last-seen timestamp.
func UpdateCameraStatus(ctx context.Context, id string, status CameraStatus, lastSeenAt *time.Time) error {
	const q = `
		UPDATE "Camera"
		SET status = $2, last_seen_at = $3, updated_at = NOW()
		WHERE id = $1`

	_, err := pool().Exec(ctx, q, id, status, lastSeenAt)
	if err != nil {
		return fmt.Errorf("UpdateCameraStatus: %w", err)
	}
	return nil
}

// ListCamerasBySchool returns all cameras for a school ordered by camera_id.
func ListCamerasBySchool(ctx context.Context, schoolID string) ([]Camera, error) {
	q := fmt.Sprintf(`SELECT %s FROM "Camera" WHERE school_id = $1 ORDER BY camera_id`, cameraColumns)

	rows, err := pool().Query(ctx, q, schoolID)
	if err != nil {
		return nil, fmt.Errorf("ListCamerasBySchool: %w", err)
	}
	defer rows.Close()

	var cameras []Camera
	for rows.Next() {
		var c Camera
		if err := rows.Scan(
			&c.ID, &c.CameraID, &c.Name, &c.Zone, &c.Type, &c.Resolution,
			&c.RtspURL, &c.Status, &c.LastSeenAt, &c.SchoolID,
			&c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("ListCamerasBySchool scan: %w", err)
		}
		cameras = append(cameras, c)
	}
	return cameras, rows.Err()
}

// MarkStaleCameras sets status to OFFLINE for cameras that have not been seen
// since the given threshold time.
func MarkStaleCameras(ctx context.Context, threshold time.Time) (int64, error) {
	const q = `
		UPDATE "Camera"
		SET status = 'OFFLINE', updated_at = NOW()
		WHERE status != 'OFFLINE'
		  AND (last_seen_at IS NULL OR last_seen_at < $1)`

	tag, err := pool().Exec(ctx, q, threshold)
	if err != nil {
		return 0, fmt.Errorf("MarkStaleCameras: %w", err)
	}
	return tag.RowsAffected(), nil
}

// ─── Alert ────────────────────────────────────────────────

// CreateAlert inserts a new alert and returns it with the generated ID.
func CreateAlert(ctx context.Context, a *Alert) (*Alert, error) {
	a.ID = cuid.New()
	a.CreatedAt = time.Now().UTC()
	a.UpdatedAt = a.CreatedAt

	const q = `
		INSERT INTO "Alert" (id, type, title, detail, resolved, camera_id, school_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err := pool().Exec(ctx, q,
		a.ID, a.Type, a.Title, a.Detail, a.Resolved,
		a.CameraID, a.SchoolID, a.CreatedAt, a.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateAlert: %w", err)
	}
	return a, nil
}

// ListAlerts retrieves alerts for a school with optional filters and pagination.
func ListAlerts(ctx context.Context, p AlertListParams) ([]Alert, error) {
	var (
		clauses []string
		args    []any
		argIdx  int
	)

	nextArg := func() string {
		argIdx++
		return fmt.Sprintf("$%d", argIdx)
	}

	clauses = append(clauses, fmt.Sprintf("school_id = %s", nextArg()))
	args = append(args, p.SchoolID)

	if p.Type != nil {
		clauses = append(clauses, fmt.Sprintf("type = %s", nextArg()))
		args = append(args, *p.Type)
	}
	if p.Resolved != nil {
		clauses = append(clauses, fmt.Sprintf("resolved = %s", nextArg()))
		args = append(args, *p.Resolved)
	}

	where := strings.Join(clauses, " AND ")
	q := fmt.Sprintf(`
		SELECT id, type, title, detail, resolved, camera_id, school_id, created_at, updated_at
		FROM "Alert"
		WHERE %s
		ORDER BY created_at DESC
		LIMIT %s OFFSET %s`, where, nextArg(), nextArg())
	args = append(args, p.Limit, p.Offset)

	rows, err := pool().Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("ListAlerts: %w", err)
	}
	defer rows.Close()

	var alerts []Alert
	for rows.Next() {
		var a Alert
		if err := rows.Scan(
			&a.ID, &a.Type, &a.Title, &a.Detail, &a.Resolved,
			&a.CameraID, &a.SchoolID, &a.CreatedAt, &a.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("ListAlerts scan: %w", err)
		}
		alerts = append(alerts, a)
	}
	return alerts, rows.Err()
}

// ResolveAlert marks an alert as resolved.
func ResolveAlert(ctx context.Context, id string) error {
	const q = `UPDATE "Alert" SET resolved = true, updated_at = NOW() WHERE id = $1`
	tag, err := pool().Exec(ctx, q, id)
	if err != nil {
		return fmt.Errorf("ResolveAlert: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("ResolveAlert: alert %q not found", id)
	}
	return nil
}

// CountAlerts returns the number of alerts for a school with optional filters.
func CountAlerts(ctx context.Context, schoolID string, alertType *AlertType, resolved *bool) (int, error) {
	var (
		clauses []string
		args    []any
		argIdx  int
	)

	nextArg := func() string {
		argIdx++
		return fmt.Sprintf("$%d", argIdx)
	}

	clauses = append(clauses, fmt.Sprintf("school_id = %s", nextArg()))
	args = append(args, schoolID)

	if alertType != nil {
		clauses = append(clauses, fmt.Sprintf("type = %s", nextArg()))
		args = append(args, *alertType)
	}
	if resolved != nil {
		clauses = append(clauses, fmt.Sprintf("resolved = %s", nextArg()))
		args = append(args, *resolved)
	}

	q := fmt.Sprintf(`SELECT COUNT(*) FROM "Alert" WHERE %s`, strings.Join(clauses, " AND "))

	var count int
	err := pool().QueryRow(ctx, q, args...).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("CountAlerts: %w", err)
	}
	return count, nil
}

// ─── MotionEvent ──────────────────────────────────────────

// CreateMotionEvent inserts a new motion event.
func CreateMotionEvent(ctx context.Context, m *MotionEvent) (*MotionEvent, error) {
	m.ID = cuid.New()
	if m.RecordedAt.IsZero() {
		m.RecordedAt = time.Now().UTC()
	}
	if m.Count == 0 {
		m.Count = 1
	}

	const q = `
		INSERT INTO "MotionEvent" (id, count, camera_id, school_id, recorded_at)
		VALUES ($1, $2, $3, $4, $5)`

	_, err := pool().Exec(ctx, q, m.ID, m.Count, m.CameraID, m.SchoolID, m.RecordedAt)
	if err != nil {
		return nil, fmt.Errorf("CreateMotionEvent: %w", err)
	}
	return m, nil
}

// AggregateMotionEvents returns motion counts bucketed by the given interval
// (e.g. '1 hour', '1 day') within the specified time range for a school.
func AggregateMotionEvents(ctx context.Context, schoolID string, from, to time.Time, interval string) ([]MotionAggregate, error) {
	const q = `
		SELECT date_trunc($1, recorded_at) AS bucket,
		       COALESCE(SUM(count), 0)::int AS total
		FROM "MotionEvent"
		WHERE school_id = $2
		  AND recorded_at >= $3
		  AND recorded_at < $4
		GROUP BY bucket
		ORDER BY bucket`

	rows, err := pool().Query(ctx, q, interval, schoolID, from, to)
	if err != nil {
		return nil, fmt.Errorf("AggregateMotionEvents: %w", err)
	}
	defer rows.Close()

	var aggs []MotionAggregate
	for rows.Next() {
		var a MotionAggregate
		if err := rows.Scan(&a.Bucket, &a.Total); err != nil {
			return nil, fmt.Errorf("AggregateMotionEvents scan: %w", err)
		}
		aggs = append(aggs, a)
	}
	return aggs, rows.Err()
}

// GroupMotionByCamera returns total motion per camera for a school within a
// time range, ordered descending by total.
func GroupMotionByCamera(ctx context.Context, schoolID string, from, to time.Time) ([]MotionByCamera, error) {
	const q = `
		SELECT me.camera_id, c.name, COALESCE(SUM(me.count), 0)::int AS total
		FROM "MotionEvent" me
		JOIN "Camera" c ON c.id = me.camera_id
		WHERE me.school_id = $1
		  AND me.recorded_at >= $2
		  AND me.recorded_at < $3
		GROUP BY me.camera_id, c.name
		ORDER BY total DESC`

	rows, err := pool().Query(ctx, q, schoolID, from, to)
	if err != nil {
		return nil, fmt.Errorf("GroupMotionByCamera: %w", err)
	}
	defer rows.Close()

	var results []MotionByCamera
	for rows.Next() {
		var m MotionByCamera
		if err := rows.Scan(&m.CameraID, &m.Name, &m.Total); err != nil {
			return nil, fmt.Errorf("GroupMotionByCamera scan: %w", err)
		}
		results = append(results, m)
	}
	return results, rows.Err()
}

// ─── User ─────────────────────────────────────────────────

const userColumns = `id, email, name, password, role, active, school_id, created_at, updated_at`

func scanUser(row pgx.Row) (*User, error) {
	var u User
	err := row.Scan(
		&u.ID, &u.Email, &u.Name, &u.Password, &u.Role,
		&u.Active, &u.SchoolID, &u.CreatedAt, &u.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// FindUserByID returns a user by primary key, or nil if not found.
func FindUserByID(ctx context.Context, id string) (*User, error) {
	q := fmt.Sprintf(`SELECT %s FROM "User" WHERE id = $1`, userColumns)
	u, err := scanUser(pool().QueryRow(ctx, q, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindUserByID: %w", err)
	}
	return u, nil
}

// FindUserByEmail returns a user by email address, or nil if not found.
func FindUserByEmail(ctx context.Context, email string) (*User, error) {
	q := fmt.Sprintf(`SELECT %s FROM "User" WHERE email = $1`, userColumns)
	u, err := scanUser(pool().QueryRow(ctx, q, email))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindUserByEmail: %w", err)
	}
	return u, nil
}

// CreateUser inserts a new user. The password field must already be hashed.
func CreateUser(ctx context.Context, u *User) (*User, error) {
	u.ID = cuid.New()
	u.CreatedAt = time.Now().UTC()
	u.UpdatedAt = u.CreatedAt
	if !u.Active {
		u.Active = true // default
	}

	const q = `
		INSERT INTO "User" (id, email, name, password, role, active, school_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	_, err := pool().Exec(ctx, q,
		u.ID, u.Email, u.Name, u.Password, u.Role,
		u.Active, u.SchoolID, u.CreatedAt, u.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("CreateUser: %w", err)
	}
	return u, nil
}

// ListUsers returns users, optionally filtered by school and/or role.
func ListUsers(ctx context.Context, schoolID *string, role *Role, limit, offset int) ([]User, error) {
	var (
		clauses []string
		args    []any
		argIdx  int
	)

	nextArg := func() string {
		argIdx++
		return fmt.Sprintf("$%d", argIdx)
	}

	if schoolID != nil {
		clauses = append(clauses, fmt.Sprintf("school_id = %s", nextArg()))
		args = append(args, *schoolID)
	}
	if role != nil {
		clauses = append(clauses, fmt.Sprintf("role = %s", nextArg()))
		args = append(args, *role)
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	q := fmt.Sprintf(`SELECT %s FROM "User" %s ORDER BY created_at DESC LIMIT %s OFFSET %s`,
		userColumns, where, nextArg(), nextArg())
	args = append(args, limit, offset)

	rows, err := pool().Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("ListUsers: %w", err)
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Name, &u.Password, &u.Role,
			&u.Active, &u.SchoolID, &u.CreatedAt, &u.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("ListUsers scan: %w", err)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// UpdateUser updates the mutable fields of a user.
func UpdateUser(ctx context.Context, id, name, email string, role Role, schoolID *string) error {
	const q = `
		UPDATE "User"
		SET name = $2, email = $3, role = $4, school_id = $5, updated_at = NOW()
		WHERE id = $1`

	tag, err := pool().Exec(ctx, q, id, name, email, role, schoolID)
	if err != nil {
		return fmt.Errorf("UpdateUser: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("UpdateUser: user %q not found", id)
	}
	return nil
}

// SetUserActive sets a user's active flag to the given value.
func SetUserActive(ctx context.Context, id string, active bool) error {
	const q = `UPDATE "User" SET active = $2, updated_at = NOW() WHERE id = $1`
	tag, err := pool().Exec(ctx, q, id, active)
	if err != nil {
		return fmt.Errorf("SetUserActive: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("SetUserActive: user %q not found", id)
	}
	return nil
}

// DeactivateUser sets a user's active flag to false.
func DeactivateUser(ctx context.Context, id string) error {
	const q = `UPDATE "User" SET active = false, updated_at = NOW() WHERE id = $1`
	tag, err := pool().Exec(ctx, q, id)
	if err != nil {
		return fmt.Errorf("DeactivateUser: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("DeactivateUser: user %q not found", id)
	}
	return nil
}

// CountActiveUsers returns the number of active users for a school.
func CountActiveUsers(ctx context.Context, schoolID string) (int, error) {
	const q = `SELECT COUNT(*) FROM "User" WHERE school_id = $1 AND active = true`
	var count int
	err := pool().QueryRow(ctx, q, schoolID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("CountActiveUsers: %w", err)
	}
	return count, nil
}

// ─── School ───────────────────────────────────────────────

const schoolColumns = `id, name, slug, address, ip_range, created_at, updated_at,
		local_storage_enabled, cloud_storage_enabled, remote_access_enabled, local_view_enabled,
		retention_days, max_cameras, max_users`

func scanSchool(row pgx.Row) (*School, error) {
	var s School
	err := row.Scan(
		&s.ID, &s.Name, &s.Slug, &s.Address, &s.IPRange,
		&s.CreatedAt, &s.UpdatedAt,
		&s.LocalStorageEnabled, &s.CloudStorageEnabled,
		&s.RemoteAccessEnabled, &s.LocalViewEnabled,
		&s.RetentionDays, &s.MaxCameras, &s.MaxUsers,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// FindSchoolByID returns a school by primary key, or nil if not found.
func FindSchoolByID(ctx context.Context, id string) (*School, error) {
	q := fmt.Sprintf(`SELECT %s FROM "School" WHERE id = $1`, schoolColumns)
	s, err := scanSchool(pool().QueryRow(ctx, q, id))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindSchoolByID: %w", err)
	}
	return s, nil
}

// ListSchools returns all schools with aggregate stats (camera, user, alert counts).
func ListSchools(ctx context.Context) ([]SchoolWithStats, error) {
	const q = `
		SELECT s.id, s.name, s.slug, s.address, s.ip_range, s.created_at, s.updated_at,
		       s.local_storage_enabled, s.cloud_storage_enabled,
		       s.remote_access_enabled, s.local_view_enabled,
		       s.retention_days, s.max_cameras, s.max_users,
		       COALESCE(cam.cnt, 0)::int AS camera_count,
		       COALESCE(cam.online_cnt, 0)::int AS online_camera_count,
		       COALESCE(usr.cnt, 0)::int AS user_count,
		       COALESCE(alt.cnt, 0)::int AS alert_count
		FROM "School" s
		LEFT JOIN (
			SELECT school_id,
			       COUNT(*) AS cnt,
			       COUNT(*) FILTER (WHERE status = 'ONLINE') AS online_cnt
			FROM "Camera" GROUP BY school_id
		) cam ON cam.school_id = s.id
		LEFT JOIN (
			SELECT school_id, COUNT(*) AS cnt
			FROM "User" WHERE active = true GROUP BY school_id
		) usr ON usr.school_id = s.id
		LEFT JOIN (
			SELECT school_id, COUNT(*) AS cnt
			FROM "Alert" WHERE resolved = false GROUP BY school_id
		) alt ON alt.school_id = s.id
		ORDER BY s.name`

	rows, err := pool().Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("ListSchools: %w", err)
	}
	defer rows.Close()

	var schools []SchoolWithStats
	for rows.Next() {
		var sw SchoolWithStats
		if err := rows.Scan(
			&sw.ID, &sw.Name, &sw.Slug, &sw.Address, &sw.IPRange,
			&sw.CreatedAt, &sw.UpdatedAt,
			&sw.LocalStorageEnabled, &sw.CloudStorageEnabled,
			&sw.RemoteAccessEnabled, &sw.LocalViewEnabled,
			&sw.RetentionDays, &sw.MaxCameras, &sw.MaxUsers,
			&sw.CameraCount, &sw.OnlineCameraCount,
			&sw.UserCount, &sw.AlertCount,
		); err != nil {
			return nil, fmt.Errorf("ListSchools scan: %w", err)
		}
		schools = append(schools, sw)
	}
	return schools, rows.Err()
}

// UpdateSchoolSettings updates the configurable settings on a school.
func UpdateSchoolSettings(ctx context.Context, id string, s *School) error {
	const q = `
		UPDATE "School"
		SET name = $2, address = $3, ip_range = $4,
		    local_storage_enabled = $5, cloud_storage_enabled = $6,
		    remote_access_enabled = $7, local_view_enabled = $8,
		    retention_days = $9, max_cameras = $10, max_users = $11,
		    updated_at = NOW()
		WHERE id = $1`

	tag, err := pool().Exec(ctx, q,
		id, s.Name, s.Address, s.IPRange,
		s.LocalStorageEnabled, s.CloudStorageEnabled,
		s.RemoteAccessEnabled, s.LocalViewEnabled,
		s.RetentionDays, s.MaxCameras, s.MaxUsers,
	)
	if err != nil {
		return fmt.Errorf("UpdateSchoolSettings: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("UpdateSchoolSettings: school %q not found", id)
	}
	return nil
}

// FindSchoolFlags returns only the feature-flag columns for a school.
func FindSchoolFlags(ctx context.Context, schoolID string) (*SchoolFlags, error) {
	const q = `
		SELECT local_storage_enabled, cloud_storage_enabled,
		       remote_access_enabled, local_view_enabled
		FROM "School"
		WHERE id = $1`

	var f SchoolFlags
	err := pool().QueryRow(ctx, q, schoolID).Scan(
		&f.LocalStorageEnabled, &f.CloudStorageEnabled,
		&f.RemoteAccessEnabled, &f.LocalViewEnabled,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("FindSchoolFlags: %w", err)
	}
	return &f, nil
}
