"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type {
  AlertPayload,
  CameraStatusPayload,
  DashboardUpdatePayload,
  BridgeStatusPayload,
} from "@/lib/socket-types";

interface UseSocketOptions {
  schoolId?: string | null;
  isOps?: boolean;
}

interface UseSocketReturn {
  connected: boolean;
  onAlert: (handler: (alert: AlertPayload) => void) => void;
  onCameraStatus: (handler: (data: CameraStatusPayload) => void) => void;
  onDashboardUpdate: (handler: (data: DashboardUpdatePayload) => void) => void;
  onBridgeStatus: (handler: (data: BridgeStatusPayload) => void) => void;
}

export function useSocket({
  schoolId,
  isOps,
}: UseSocketOptions = {}): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  // Store handlers in refs so they don't trigger reconnects
  const alertHandlerRef = useRef<((alert: AlertPayload) => void) | null>(null);
  const cameraHandlerRef = useRef<
    ((data: CameraStatusPayload) => void) | null
  >(null);
  const dashboardHandlerRef = useRef<
    ((data: DashboardUpdatePayload) => void) | null
  >(null);
  const bridgeHandlerRef = useRef<
    ((data: BridgeStatusPayload) => void) | null
  >(null);

  useEffect(() => {
    // Get JWT from session cookie for socket auth
    async function connect() {
      try {
        const res = await fetch("/api/auth/session");
        const session = await res.json();

        if (!session?.user) return;

        // Create a simple auth token from session data
        const authPayload = {
          id: session.user.id,
          role: session.user.role,
          schoolId: session.user.schoolId,
        };

        const token = `header.${btoa(JSON.stringify(authPayload))}.sig`;

        const socket = io({
          path: "/api/socketio",
          auth: { token },
          transports: ["websocket", "polling"],
          reconnection: true,
          reconnectionAttempts: 10,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
        });

        socket.on("connect", () => {
          setConnected(true);
          console.log("[Socket] Connected");

          // Join rooms
          if (schoolId) {
            socket.emit("join:school", schoolId);
          }
          if (isOps) {
            socket.emit("join:ops");
          }
        });

        socket.on("disconnect", () => {
          setConnected(false);
          console.log("[Socket] Disconnected");
        });

        // Wire up event handlers
        socket.on("alert:new", (data) => {
          alertHandlerRef.current?.(data as AlertPayload);
        });

        socket.on("camera:statusChange", (data) => {
          cameraHandlerRef.current?.(data as CameraStatusPayload);
        });

        socket.on("dashboard:update", (data) => {
          dashboardHandlerRef.current?.(data as DashboardUpdatePayload);
        });

        socket.on("bridge:status", (data) => {
          bridgeHandlerRef.current?.(data as BridgeStatusPayload);
        });

        socketRef.current = socket;
      } catch (error) {
        console.error("[Socket] Connection error:", error);
      }
    }

    connect();

    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [schoolId, isOps]);

  const onAlert = useCallback((handler: (alert: AlertPayload) => void) => {
    alertHandlerRef.current = handler;
  }, []);

  const onCameraStatus = useCallback(
    (handler: (data: CameraStatusPayload) => void) => {
      cameraHandlerRef.current = handler;
    },
    []
  );

  const onDashboardUpdate = useCallback(
    (handler: (data: DashboardUpdatePayload) => void) => {
      dashboardHandlerRef.current = handler;
    },
    []
  );

  const onBridgeStatus = useCallback(
    (handler: (data: BridgeStatusPayload) => void) => {
      bridgeHandlerRef.current = handler;
    },
    []
  );

  return {
    connected,
    onAlert,
    onCameraStatus,
    onDashboardUpdate,
    onBridgeStatus,
  };
}
