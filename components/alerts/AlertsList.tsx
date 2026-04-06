"use client";

import { useState, useEffect, useCallback } from "react";
import AlertItem from "./AlertItem";

type AlertType = "CRITICAL" | "WARNING" | "INFO";
type FilterType = "ALL" | AlertType;
type ResolvedFilter = "all" | "active" | "resolved";

interface Alert {
  id: string;
  type: AlertType;
  title: string;
  detail: string | null;
  resolved: boolean;
  createdAt: string;
  camera: {
    cameraId: string;
    name: string;
    zone: string;
  } | null;
}

interface AlertsListProps {
  canResolve: boolean;
}

export default function AlertsList({ canResolve }: AlertsListProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<FilterType>("ALL");
  const [resolvedFilter, setResolvedFilter] = useState<ResolvedFilter>("active");

  const fetchAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      if (resolvedFilter !== "all") {
        params.set("resolved", resolvedFilter === "resolved" ? "true" : "false");
      }
      params.set("limit", "100");

      const res = await fetch(`/api/alerts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts);
        setTotal(data.total);
      }
    } catch {
      // Keep existing data
    } finally {
      setLoading(false);
    }
  }, [typeFilter, resolvedFilter]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  async function handleResolve(id: string) {
    try {
      const res = await fetch(`/api/alerts/${id}/resolve`, { method: "POST" });
      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, resolved: true } : a))
        );
      }
    } catch {
      // Silently fail
    }
  }

  const activeCount = alerts.filter((a) => !a.resolved).length;
  const criticalCount = alerts.filter((a) => a.type === "CRITICAL" && !a.resolved).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-text-primary">
          Alerts
          {activeCount > 0 && (
            <span className="ml-2 text-sm font-normal">
              <span className="text-status-alert">{activeCount} active</span>
              {criticalCount > 0 && (
                <span className="text-status-alert ml-1">
                  ({criticalCount} critical)
                </span>
              )}
            </span>
          )}
        </h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        {/* Type filter */}
        <div className="flex items-center gap-1 bg-bg-panel border border-border rounded-md p-0.5">
          {(["ALL", "CRITICAL", "WARNING", "INFO"] as FilterType[]).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                typeFilter === type
                  ? type === "CRITICAL"
                    ? "bg-status-alert/20 text-status-alert"
                    : type === "WARNING"
                    ? "bg-status-warning/20 text-status-warning"
                    : type === "INFO"
                    ? "bg-accent/20 text-accent"
                    : "bg-accent text-white"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {type === "ALL" ? "All" : type.charAt(0) + type.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Resolved filter */}
        <div className="flex items-center gap-1 bg-bg-panel border border-border rounded-md p-0.5">
          {(["active", "resolved", "all"] as ResolvedFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setResolvedFilter(filter)}
              className={`px-2.5 py-1 text-xs rounded capitalize transition-colors ${
                resolvedFilter === filter
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-start gap-3">
                <div className="skeleton w-2.5 h-2.5 rounded-full mt-1" />
                <div className="flex-1">
                  <div className="skeleton h-4 w-16 rounded-full mb-2" />
                  <div className="skeleton h-4 w-48 mb-1" />
                  <div className="skeleton h-3 w-32" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertItem
              key={alert.id}
              alert={alert}
              onResolve={handleResolve}
              canResolve={canResolve}
            />
          ))}

          {alerts.length === 0 && (
            <div className="card p-8 text-center text-text-muted">
              {resolvedFilter === "active"
                ? "No active alerts — all clear"
                : "No alerts match the current filters"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
