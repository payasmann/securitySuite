"use client";

import { useState, useEffect } from "react";
import CameraCell from "./CameraCell";

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

const gridCols: Record<GridSize, string> = {
  "2x2": "grid-cols-2",
  "3x3": "grid-cols-3",
  "4x4": "grid-cols-4",
};

export default function CameraGrid() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [gridSize, setGridSize] = useState<GridSize>("3x3");
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [remoteBlocked, setRemoteBlocked] = useState(false);

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
