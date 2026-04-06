"use client";

import { useState, useEffect, useCallback } from "react";

type AlertType = "CRITICAL" | "WARNING" | "INFO";

interface Alert {
  id: string;
  type: AlertType;
  title: string;
  detail: string | null;
  resolved: boolean;
  createdAt: string;
  schoolId: string;
  camera: {
    cameraId: string;
    name: string;
    zone: string;
  } | null;
}

export default function OpsAlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"ALL" | AlertType>("ALL");
  const [resolvedFilter, setResolvedFilter] = useState<"active" | "resolved" | "all">("active");

  const fetchAlerts = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      if (resolvedFilter !== "all") params.set("resolved", resolvedFilter === "resolved" ? "true" : "false");
      params.set("limit", "100");

      const res = await fetch(`/api/alerts?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts);
      }
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
  }, [typeFilter, resolvedFilter]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const criticalCount = alerts.filter((a) => a.type === "CRITICAL" && !a.resolved).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-text-primary">
          All Alerts
          {criticalCount > 0 && (
            <span className="ml-2 text-sm text-status-alert font-normal">
              {criticalCount} critical
            </span>
          )}
        </h1>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-1 bg-bg-panel border border-border rounded-md p-0.5">
          {(["ALL", "CRITICAL", "WARNING", "INFO"] as const).map((type) => (
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
        <div className="flex items-center gap-1 bg-bg-panel border border-border rounded-md p-0.5">
          {(["active", "resolved", "all"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setResolvedFilter(filter)}
              className={`px-2.5 py-1 text-xs rounded capitalize transition-colors ${
                resolvedFilter === filter ? "bg-accent text-white" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Alert list */}
      <div className="space-y-2">
        {loading
          ? [...Array(5)].map((_, i) => (
              <div key={i} className="card p-4 flex items-center gap-3">
                <div className="skeleton w-2.5 h-2.5 rounded-full" />
                <div className="skeleton h-4 w-16 rounded-full" />
                <div className="skeleton h-4 w-48" />
                <div className="skeleton h-3 w-24 ml-auto" />
              </div>
            ))
          : alerts.map((alert) => (
              <div
                key={alert.id}
                className={`bg-bg-panel border rounded-card px-4 py-3 flex items-center gap-3 ${
                  alert.resolved ? "border-border opacity-60" : "border-border hover:border-border-hover transition-colors"
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    alert.type === "CRITICAL"
                      ? "bg-status-alert"
                      : alert.type === "WARNING"
                      ? "bg-status-warning"
                      : "bg-accent"
                  }`}
                />
                <span
                  className={`text-2xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${
                    alert.type === "CRITICAL"
                      ? "bg-status-alert/10 text-status-alert border-status-alert/20"
                      : alert.type === "WARNING"
                      ? "bg-status-warning/10 text-status-warning border-status-warning/20"
                      : "bg-accent/10 text-accent border-accent/20"
                  }`}
                >
                  {alert.type}
                </span>
                <span className="text-sm text-text-primary truncate">{alert.title}</span>
                {alert.camera && (
                  <span className="text-2xs text-text-muted font-mono flex-shrink-0">
                    {alert.camera.cameraId}
                  </span>
                )}
                {alert.resolved && (
                  <span className="text-2xs text-text-muted bg-bg-card px-1.5 py-0.5 rounded border border-border flex-shrink-0">
                    Resolved
                  </span>
                )}
                <span className="text-2xs text-text-muted font-mono ml-auto flex-shrink-0">
                  {new Date(alert.createdAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </span>
              </div>
            ))}

        {!loading && alerts.length === 0 && (
          <div className="card p-8 text-center text-text-muted">
            No alerts match the current filters
          </div>
        )}
      </div>
    </div>
  );
}
