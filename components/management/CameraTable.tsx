"use client";

import { useState, useEffect } from "react";

interface Camera {
  id: string;
  cameraId: string;
  name: string;
  zone: string;
  type: string;
  resolution: string;
  status: "ONLINE" | "OFFLINE" | "WARNING";
  lastSeenAt: string | null;
  recordingActive?: boolean;
}

function StatusPill({ status }: { status: string }) {
  const styles =
    status === "ONLINE"
      ? "bg-status-online/10 text-status-online border-status-online/20"
      : status === "WARNING"
      ? "bg-status-warning/10 text-status-warning border-status-warning/20"
      : "bg-status-alert/10 text-status-alert border-status-alert/20";

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs font-medium border ${styles}`}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === "ONLINE"
            ? "bg-status-online"
            : status === "WARNING"
            ? "bg-status-warning"
            : "bg-status-alert"
        }`}
      />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}

function RecordingIndicator({ active }: { active?: boolean }) {
  if (!active) {
    return <span className="text-xs text-text-muted">&mdash;</span>;
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-status-alert">
      <span className="w-2 h-2 rounded-full bg-status-alert animate-pulse" />
      REC
    </span>
  );
}

function formatLastSeen(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function CameraTable() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCameras() {
      try {
        const res = await fetch("/api/cameras");
        if (res.ok) {
          const data = await res.json();
          setCameras(data.cameras);
        }
      } catch {
        // keep empty
      } finally {
        setLoading(false);
      }
    }
    fetchCameras();
  }, []);

  const onlineCount = cameras.filter((c) => c.status === "ONLINE").length;
  const warningCount = cameras.filter((c) => c.status === "WARNING").length;
  const offlineCount = cameras.filter((c) => c.status === "OFFLINE").length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-text-primary">
          Camera Management
          <span className="text-sm font-normal text-text-muted ml-2">
            {cameras.length} cameras
          </span>
        </h1>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-status-online">{onlineCount} online</span>
          {warningCount > 0 && (
            <span className="text-status-warning">{warningCount} warning</span>
          )}
          {offlineCount > 0 && (
            <span className="text-status-alert">{offlineCount} offline</span>
          )}
        </div>
      </div>

      <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                ID
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Name
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Zone
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Type
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Resolution
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Status
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Recording
              </th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-3">
                Last Seen
              </th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="skeleton h-4 w-16" />
                      </td>
                    ))}
                  </tr>
                ))
              : cameras.map((camera) => (
                  <tr
                    key={camera.id}
                    className="border-b border-border last:border-0 hover:bg-bg-hover/30 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {camera.cameraId}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {camera.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {camera.zone}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {camera.type}
                    </td>
                    <td className="px-4 py-3 text-xs text-text-muted">
                      {camera.resolution}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={camera.status} />
                    </td>
                    <td className="px-4 py-3">
                      <RecordingIndicator active={camera.recordingActive} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {formatLastSeen(camera.lastSeenAt)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && cameras.length === 0 && (
          <div className="p-8 text-center text-text-muted text-sm">
            No cameras configured
          </div>
        )}
      </div>
    </div>
  );
}
