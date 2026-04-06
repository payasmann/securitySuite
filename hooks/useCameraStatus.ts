"use client";

import { useState, useEffect, useCallback } from "react";
import { useSocket } from "./useSocket";

interface CameraState {
  id: string;
  cameraId: string;
  status: "ONLINE" | "OFFLINE" | "WARNING";
}

export function useCameraStatus(
  initialCameras: CameraState[],
  schoolId: string | null
) {
  const [cameras, setCameras] = useState<Map<string, CameraState>>(
    new Map(initialCameras.map((c) => [c.id, c]))
  );

  const { connected, onCameraStatus } = useSocket({ schoolId });

  const handleStatusChange = useCallback(
    (data: {
      cameraDatabaseId: string;
      status: "ONLINE" | "OFFLINE" | "WARNING";
    }) => {
      setCameras((prev) => {
        const next = new Map(prev);
        const existing = next.get(data.cameraDatabaseId);
        if (existing) {
          next.set(data.cameraDatabaseId, {
            ...existing,
            status: data.status,
          });
        }
        return next;
      });
    },
    []
  );

  useEffect(() => {
    onCameraStatus(handleStatusChange);
  }, [onCameraStatus, handleStatusChange]);

  // Sync with initial cameras when they change
  useEffect(() => {
    setCameras(new Map(initialCameras.map((c) => [c.id, c])));
  }, [initialCameras]);

  return {
    cameras: Array.from(cameras.values()),
    connected,
    getCameraStatus: (id: string) => cameras.get(id)?.status || "OFFLINE",
  };
}
