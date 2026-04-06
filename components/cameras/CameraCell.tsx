"use client";

import { useState } from "react";
import LiveFeed from "./LiveFeed";

interface CameraCellProps {
  camera: {
    id: string;
    cameraId: string;
    name: string;
    zone: string;
    status: "ONLINE" | "OFFLINE" | "WARNING";
  };
  remoteBlocked?: boolean;
}

export default function CameraCell({ camera, remoteBlocked }: CameraCellProps) {
  const [feedError, setFeedError] = useState(false);

  const isOnline = camera.status === "ONLINE";
  const isWarning = camera.status === "WARNING";
  const borderColor = camera.status === "OFFLINE"
    ? "border-status-alert/40"
    : isWarning
    ? "border-status-warning/40"
    : "border-border";

  return (
    <div
      className={`bg-bg-panel border ${borderColor} rounded-card overflow-hidden flex flex-col`}
    >
      {/* Video area */}
      <div className="relative aspect-video bg-bg-app flex items-center justify-center">
        {remoteBlocked ? (
          <RemoteBlockedOverlay />
        ) : !isOnline && !isWarning ? (
          <OfflineOverlay />
        ) : feedError ? (
          <FeedErrorOverlay onRetry={() => setFeedError(false)} />
        ) : (
          <LiveFeed
            cameraId={camera.id}
            onError={() => setFeedError(true)}
          />
        )}

        {/* REC indicator */}
        {(isOnline || isWarning) && !remoteBlocked && (
          <div className="absolute top-2 left-2 flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-status-alert rec-pulse" />
            <span className="text-2xs font-mono text-status-alert font-medium">
              REC
            </span>
          </div>
        )}

        {/* Timestamp */}
        <div className="absolute bottom-2 right-2">
          <LiveTimestamp />
        </div>
      </div>

      {/* Info bar */}
      <div className="px-3 py-2 flex items-center justify-between border-t border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-2xs text-text-muted flex-shrink-0">
            {camera.cameraId}
          </span>
          <span className="text-xs text-text-secondary truncate">
            {camera.name}
          </span>
        </div>
        <StatusDot status={camera.status} />
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const color =
    status === "ONLINE"
      ? "bg-status-online"
      : status === "WARNING"
      ? "bg-status-warning"
      : "bg-status-alert";

  return <div className={`w-2 h-2 rounded-full ${color} flex-shrink-0`} />;
}

function LiveTimestamp() {
  const [time, setTime] = useState("");

  useState(() => {
    const update = () => {
      setTime(
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  });

  return (
    <span className="font-mono text-2xs text-text-muted/80 bg-bg-app/80 px-1.5 py-0.5 rounded">
      {time}
    </span>
  );
}

function RemoteBlockedOverlay() {
  return (
    <div className="absolute inset-0 bg-bg-app/90 flex flex-col items-center justify-center p-4 text-center">
      <svg className="w-8 h-8 text-text-muted mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
      <p className="text-xs text-text-muted">On-premises access only</p>
      <p className="text-2xs text-text-muted/60 mt-1">
        Connect to the school network to view live feeds
      </p>
    </div>
  );
}

function OfflineOverlay() {
  return (
    <div className="absolute inset-0 bg-bg-app/90 flex flex-col items-center justify-center">
      <div className="w-3 h-3 rounded-full bg-status-alert mb-2" />
      <p className="text-xs text-text-muted">Camera Offline</p>
    </div>
  );
}

function FeedErrorOverlay({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-0 bg-bg-app/90 flex flex-col items-center justify-center">
      <p className="text-xs text-text-muted mb-2">Feed unavailable</p>
      <button
        onClick={onRetry}
        className="px-3 py-1 text-2xs bg-bg-card border border-border rounded hover:border-border-hover transition-colors text-text-secondary"
      >
        Retry
      </button>
    </div>
  );
}
