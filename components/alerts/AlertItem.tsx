"use client";

import { useState } from "react";

interface AlertItemProps {
  alert: {
    id: string;
    type: "CRITICAL" | "WARNING" | "INFO";
    title: string;
    detail: string | null;
    resolved: boolean;
    createdAt: string;
    camera: {
      cameraId: string;
      name: string;
      zone: string;
    } | null;
  };
  onResolve?: (id: string) => void;
  canResolve: boolean;
}

function getTypeStyles(type: string) {
  switch (type) {
    case "CRITICAL":
      return {
        icon: "bg-status-alert",
        badge: "bg-status-alert/10 text-status-alert border-status-alert/20",
        label: "Critical",
      };
    case "WARNING":
      return {
        icon: "bg-status-warning",
        badge: "bg-status-warning/10 text-status-warning border-status-warning/20",
        label: "Warning",
      };
    case "INFO":
      return {
        icon: "bg-accent",
        badge: "bg-accent/10 text-accent border-accent/20",
        label: "Info",
      };
    default:
      return {
        icon: "bg-text-muted",
        badge: "bg-bg-card text-text-muted border-border",
        label: type,
      };
  }
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function AlertItem({ alert, onResolve, canResolve }: AlertItemProps) {
  const styles = getTypeStyles(alert.type);
  const [resolving, setResolving] = useState(false);

  async function handleResolve() {
    if (!onResolve) return;
    setResolving(true);
    onResolve(alert.id);
  }

  return (
    <div
      className={`bg-bg-panel border rounded-card p-4 transition-colors ${
        alert.resolved ? "border-border opacity-60" : "border-border hover:border-border-hover"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Severity dot */}
        <div className={`w-2.5 h-2.5 rounded-full ${styles.icon} mt-1 flex-shrink-0`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium border ${styles.badge}`}
            >
              {styles.label}
            </span>
            {alert.resolved && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-medium bg-bg-card text-text-muted border border-border">
                Resolved
              </span>
            )}
          </div>

          <h4 className="text-sm font-medium text-text-primary mb-0.5">
            {alert.title}
          </h4>

          {alert.detail && (
            <p className="text-xs text-text-muted mb-1">{alert.detail}</p>
          )}

          <div className="flex items-center gap-3 text-2xs text-text-muted">
            {alert.camera && (
              <span className="font-mono">
                {alert.camera.cameraId} · {alert.camera.name}
              </span>
            )}
            <span>{formatTimestamp(alert.createdAt)}</span>
          </div>
        </div>

        {/* Resolve button */}
        {canResolve && !alert.resolved && (
          <button
            onClick={handleResolve}
            disabled={resolving}
            className="flex-shrink-0 px-3 py-1.5 text-xs bg-bg-card border border-border rounded-md hover:border-border-hover hover:bg-bg-hover transition-colors text-text-secondary disabled:opacity-50"
          >
            {resolving ? "..." : "Resolve"}
          </button>
        )}
      </div>
    </div>
  );
}
