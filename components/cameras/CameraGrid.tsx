"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import CameraCell from "./CameraCell";
import { useSocket } from "@/hooks/useSocket";

type GridSize = "2x2" | "3x3" | "4x4";

interface Camera {
  id: string;
  cameraId: string;
  name: string;
  zone: string;
  type: string;
  resolution: string;
  status: "ONLINE" | "OFFLINE" | "WARNING";
  lastSeenAt: string | null;
}

interface CameraGridProps {
  schoolId?: string;
}

const gridCols: Record<GridSize, string> = {
  "2x2": "grid-cols-2",
  "3x3": "grid-cols-3",
  "4x4": "grid-cols-4",
};

export default function CameraGrid({ schoolId }: CameraGridProps) {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [gridSize, setGridSize] = useState<GridSize>("3x3");
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [remoteBlocked, setRemoteBlocked] = useState(false);
  const [motionCameras, setMotionCameras] = useState<Set<string>>(new Set());
  const motionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    async function fetchCameras() {
      try {
        const res = await fetch("/api/cameras");
        if (res.ok) {
          const data = await res.json();
          setCameras(data.cameras);
        }
      } catch {
        // Fallback — show empty
      } finally {
        setLoading(false);
      }
    }

    fetchCameras();
    const interval = setInterval(fetchCameras, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Listen for real-time motion events via socket
  const { onMotionDetected } = useSocket({ schoolId });

  const addMotionCamera = useCallback((cameraDatabaseId: string) => {
    setMotionCameras((prev) => {
      const next = new Set(prev);
      next.add(cameraDatabaseId);
      return next;
    });

    // Clear any existing timer for this camera
    const existingTimer = motionTimersRef.current.get(cameraDatabaseId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Auto-clear motion state after 5 seconds
    const timer = setTimeout(() => {
      setMotionCameras((prev) => {
        const next = new Set(prev);
        next.delete(cameraDatabaseId);
        return next;
      });
      motionTimersRef.current.delete(cameraDatabaseId);
    }, 5000);

    motionTimersRef.current.set(cameraDatabaseId, timer);
  }, []);

  useEffect(() => {
    onMotionDetected((motion) => {
      addMotionCamera(motion.cameraDatabaseId);
    });
  }, [onMotionDetected, addMotionCamera]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = motionTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  if (loading) {
    return <GridSkeleton gridSize={gridSize} />;
  }

  return (
    <div>
      {/* Header with grid toggle */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-text-primary">
          Live Cameras
          <span className="text-sm font-normal text-text-muted ml-2">
            {cameras.filter((c) => c.status === "ONLINE").length}/{cameras.length} online
          </span>
        </h1>

        <div className="flex items-center gap-1 bg-bg-panel border border-border rounded-md p-0.5">
          {(["2x2", "3x3", "4x4"] as GridSize[]).map((size) => (
            <button
              key={size}
              onClick={() => setGridSize(size)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                gridSize === size
                  ? "bg-accent text-white"
                  : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Camera grid */}
      <div className={`grid ${gridCols[gridSize]} gap-3`}>
        {cameras.map((camera) => (
          <CameraCell
            key={camera.id}
            camera={camera}
            remoteBlocked={remoteBlocked}
            motionActive={motionCameras.has(camera.id)}
          />
        ))}
      </div>

      {cameras.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-text-muted">No cameras configured for this school</p>
        </div>
      )}
    </div>
  );
}

function GridSkeleton({ gridSize }: { gridSize: GridSize }) {
  const count = gridSize === "2x2" ? 4 : gridSize === "3x3" ? 9 : 16;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-8 w-32 rounded-md" />
      </div>
      <div className={`grid ${gridCols[gridSize]} gap-3`}>
        {[...Array(count)].map((_, i) => (
          <div key={i} className="bg-bg-panel border border-border rounded-card overflow-hidden">
            <div className="aspect-video skeleton" />
            <div className="px-3 py-2 flex items-center gap-2 border-t border-border">
              <div className="skeleton h-3 w-12" />
              <div className="skeleton h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
