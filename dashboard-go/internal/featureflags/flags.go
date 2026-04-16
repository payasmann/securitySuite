package featureflags

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SchoolFlags holds the feature flag values for a school.
type SchoolFlags struct {
	LocalStorageEnabled bool `json:"localStorageEnabled"`
	CloudStorageEnabled bool `json:"cloudStorageEnabled"`
	RemoteAccessEnabled bool `json:"remoteAccessEnabled"`
	LocalViewEnabled    bool `json:"localViewEnabled"`
	RetentionDays       int  `json:"retentionDays"`
	MaxCameras          int  `json:"maxCameras"`
	MaxUsers            int  `json:"maxUsers"`
}

// cacheEntry holds a cached flags result with an expiration timestamp.
type cacheEntry struct {
	flags     *SchoolFlags
	expiresAt time.Time
}

const cacheTTL = 60 * time.Second

// flagsCache is a concurrent-safe in-memory cache keyed by school ID.
var flagsCache sync.Map

// GetSchoolFlags retrieves the feature flags for the given school, using a
// 60-second in-memory cache to reduce database load. Returns nil if the
// school is not found.
func GetSchoolFlags(ctx context.Context, pool *pgxpool.Pool, schoolID string) (*SchoolFlags, error) {
	// Check cache first.
	if val, ok := flagsCache.Load(schoolID); ok {
		entry := val.(*cacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.flags, nil
		}
		// Expired — remove and fall through to DB query.
		flagsCache.Delete(schoolID)
	}

	query := `
		SELECT
			local_storage_enabled,
			cloud_storage_enabled,
			remote_access_enabled,
			local_view_enabled,
			retention_days,
			max_cameras,
			max_users
		FROM schools
		WHERE id = $1
	`

	var flags SchoolFlags
	err := pool.QueryRow(ctx, query, schoolID).Scan(
		&flags.LocalStorageEnabled,
		&flags.CloudStorageEnabled,
		&flags.RemoteAccessEnabled,
		&flags.LocalViewEnabled,
		&flags.RetentionDays,
		&flags.MaxCameras,
		&flags.MaxUsers,
	)
	if err != nil {
		// pgx returns ErrNoRows when the school doesn't exist.
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("featureflags: failed to query school flags: %w", err)
	}

	// Store in cache.
	flagsCache.Store(schoolID, &cacheEntry{
		flags:     &flags,
		expiresAt: time.Now().Add(cacheTTL),
	})

	return &flags, nil
}

// InvalidateSchoolFlags removes the cached flags for a school so the next
// call to GetSchoolFlags will query the database. Call this after updating
// a school's feature flag settings.
func InvalidateSchoolFlags(schoolID string) {
	flagsCache.Delete(schoolID)
}

// IsLiveViewEnabled checks whether local/live viewing is enabled for a school.
func IsLiveViewEnabled(ctx context.Context, pool *pgxpool.Pool, schoolID string) (bool, error) {
	flags, err := GetSchoolFlags(ctx, pool, schoolID)
	if err != nil {
		return false, err
	}
	if flags == nil {
		return false, nil
	}
	return flags.LocalViewEnabled, nil
}

// IsRemoteAccessEnabled checks whether remote access is enabled for a school.
func IsRemoteAccessEnabled(ctx context.Context, pool *pgxpool.Pool, schoolID string) (bool, error) {
	flags, err := GetSchoolFlags(ctx, pool, schoolID)
	if err != nil {
		return false, err
	}
	if flags == nil {
		return false, nil
	}
	return flags.RemoteAccessEnabled, nil
}

// IsCloudStorageEnabled checks whether cloud storage is enabled for a school.
func IsCloudStorageEnabled(ctx context.Context, pool *pgxpool.Pool, schoolID string) (bool, error) {
	flags, err := GetSchoolFlags(ctx, pool, schoolID)
	if err != nil {
		return false, err
	}
	if flags == nil {
		return false, nil
	}
	return flags.CloudStorageEnabled, nil
}

// CanAddCamera checks whether adding another camera is permitted for the
// school by comparing the current camera count against the maxCameras limit.
func CanAddCamera(ctx context.Context, pool *pgxpool.Pool, schoolID string) (bool, error) {
	flags, err := GetSchoolFlags(ctx, pool, schoolID)
	if err != nil {
		return false, err
	}
	if flags == nil {
		return false, nil
	}

	var count int
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM cameras WHERE school_id = $1`, schoolID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("featureflags: failed to count cameras: %w", err)
	}

	return count < flags.MaxCameras, nil
}

// CanAddUser checks whether adding another active user is permitted for the
// school by comparing the current active user count against the maxUsers limit.
func CanAddUser(ctx context.Context, pool *pgxpool.Pool, schoolID string) (bool, error) {
	flags, err := GetSchoolFlags(ctx, pool, schoolID)
	if err != nil {
		return false, err
	}
	if flags == nil {
		return false, nil
	}

	var count int
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE school_id = $1 AND active = true`, schoolID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("featureflags: failed to count users: %w", err)
	}

	return count < flags.MaxUsers, nil
}

// IsIPInRange checks whether clientIP falls within the given CIDR range.
// Returns true if cidr is empty (no restriction configured).
// Supports IPv4 CIDR notation (e.g., "192.168.1.0/24").
func IsIPInRange(clientIP, cidr string) bool {
	if cidr == "" {
		return true // No IP restriction configured.
	}

	_, network, err := net.ParseCIDR(cidr)
	if err != nil {
		return false
	}

	ip := net.ParseIP(clientIP)
	if ip == nil {
		return false
	}

	return network.Contains(ip)
}
