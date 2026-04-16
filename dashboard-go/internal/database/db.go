package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool is the package-level connection pool singleton.
// Set by calling NewPool during application startup.
var Pool *pgxpool.Pool

// NewPool creates a new pgxpool.Pool from the given PostgreSQL connection
// string and verifies connectivity with a ping. On success it also sets the
// package-level Pool variable so that callers can use database.Pool directly.
func NewPool(databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("database: parse config: %w", err)
	}

	// Sensible pool defaults — adjust via connection-string params if needed.
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("database: create pool: %w", err)
	}

	// Verify the connection is usable.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: ping: %w", err)
	}

	Pool = pool
	return pool, nil
}

// Close gracefully shuts down the pool. Safe to call if Pool is nil.
func Close() {
	if Pool != nil {
		Pool.Close()
	}
}
