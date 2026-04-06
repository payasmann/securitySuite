import { Server as SocketServer } from "socket.io";
import type { Server as HttpServer } from "http";

// ─── Event Types ─────────────────────────────────────────

export interface ServerToClientEvents {
  "alert:new": (data: {
    id: string;
    type: string;
    title: string;
    detail: string | null;
    cameraId: string | null;
    schoolId: string;
    createdAt: string;
  }) => void;
  "camera:statusChange": (data: {
    cameraId: string;
    cameraDatabaseId: string;
    status: "ONLINE" | "OFFLINE" | "WARNING";
    schoolId: string;
  }) => void;
  "dashboard:update": (data: {
    schoolId: string;
    stats: {
      camerasOnline: number;
      camerasTotal: number;
      activeAlerts: number;
      motionEvents: number;
    };
  }) => void;
  "bridge:status": (data: {
    schoolId: string;
    online: boolean;
    lastPingAt: string;
  }) => void;
  "motion:detected": (data: {
    cameraId: string;
    cameraDatabaseId: string;
    cameraName: string;
    zone: string;
    schoolId: string;
    timestamp: string;
  }) => void;
}

export interface ClientToServerEvents {
  "join:school": (schoolId: string) => void;
  "join:ops": () => void;
}

interface SocketData {
  userId: string;
  role: string;
  schoolId: string | null;
}

// ─── Singleton ───────────────────────────────────────────

let io: SocketServer<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
> | null = null;

export function getIO() {
  return io;
}

// ─── Initialize ──────────────────────────────────────────

export function initSocketServer(httpServer: HttpServer): SocketServer {
  if (io) return io;

  io = new SocketServer<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer, {
    cors: {
      origin: process.env.NEXTAUTH_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/api/socketio",
    transports: ["websocket", "polling"],
  });

  // ─── Authentication Middleware ────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      // Decode JWT token — in production, verify with the AUTH_SECRET
      // For now, we trust the token payload passed from the client
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString()
      );

      if (!payload.id || !payload.role) {
        return next(new Error("Invalid token"));
      }

      socket.data.userId = payload.id;
      socket.data.role = payload.role;
      socket.data.schoolId = payload.schoolId || null;

      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  // ─── Connection Handler ──────────────────────────────
  io.on("connection", (socket) => {
    console.log(
      `[Socket] Connected: ${socket.data.userId} (${socket.data.role})`
    );

    // Auto-join school room for school users
    if (socket.data.schoolId) {
      socket.join(`school:${socket.data.schoolId}`);
      console.log(
        `[Socket] ${socket.data.userId} joined school:${socket.data.schoolId}`
      );
    }

    // Auto-join ops room for ops users
    if (
      socket.data.role === "SUPER_ADMIN" ||
      socket.data.role === "OPS_VIEWER"
    ) {
      socket.join("ops");
      console.log(`[Socket] ${socket.data.userId} joined ops`);
    }

    // Manual room joins (validated server-side)
    socket.on("join:school", (schoolId) => {
      // Only allow joining own school or ops users joining any school
      if (
        socket.data.role === "SUPER_ADMIN" ||
        socket.data.role === "OPS_VIEWER" ||
        socket.data.schoolId === schoolId
      ) {
        socket.join(`school:${schoolId}`);
      }
    });

    socket.on("join:ops", () => {
      if (
        socket.data.role === "SUPER_ADMIN" ||
        socket.data.role === "OPS_VIEWER"
      ) {
        socket.join("ops");
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[Socket] Disconnected: ${socket.data.userId} (${reason})`
      );
    });
  });

  console.log("[Socket] Socket.io server initialized");
  return io;
}

// ─── Emit Helpers ────────────────────────────────────────

/**
 * Emit a new alert to the school room and ops room
 */
export function emitAlert(
  alert: ServerToClientEvents["alert:new"] extends (data: infer D) => void
    ? D
    : never
) {
  if (!io) return;
  io.to(`school:${alert.schoolId}`).emit("alert:new", alert);
  io.to("ops").emit("alert:new", alert);
}

/**
 * Emit a camera status change to the school room and ops room
 */
export function emitCameraStatus(
  data: ServerToClientEvents["camera:statusChange"] extends (
    data: infer D
  ) => void
    ? D
    : never
) {
  if (!io) return;
  io.to(`school:${data.schoolId}`).emit("camera:statusChange", data);
  io.to("ops").emit("camera:statusChange", data);
}

/**
 * Emit dashboard stats update to a school room
 */
export function emitDashboardUpdate(
  data: ServerToClientEvents["dashboard:update"] extends (
    data: infer D
  ) => void
    ? D
    : never
) {
  if (!io) return;
  io.to(`school:${data.schoolId}`).emit("dashboard:update", data);
}

/**
 * Emit bridge status change to school and ops rooms
 */
export function emitBridgeStatus(
  data: ServerToClientEvents["bridge:status"] extends (data: infer D) => void
    ? D
    : never
) {
  if (!io) return;
  io.to(`school:${data.schoolId}`).emit("bridge:status", data);
  io.to("ops").emit("bridge:status", data);
}

/**
 * Emit motion detected event to school and ops rooms
 */
export function emitMotionDetected(
  data: ServerToClientEvents["motion:detected"] extends (data: infer D) => void
    ? D
    : never
) {
  if (!io) return;
  io.to(`school:${data.schoolId}`).emit("motion:detected", data);
  io.to("ops").emit("motion:detected", data);
}
