// Event payload types used by both client hooks and server emitters

export interface AlertPayload {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  cameraId: string | null;
  schoolId: string;
  createdAt: string;
}

export interface CameraStatusPayload {
  cameraId: string;
  cameraDatabaseId: string;
  status: "ONLINE" | "OFFLINE" | "WARNING";
  schoolId: string;
}

export interface DashboardUpdatePayload {
  schoolId: string;
  stats: {
    camerasOnline: number;
    camerasTotal: number;
    activeAlerts: number;
    motionEvents: number;
  };
}

export interface BridgeStatusPayload {
  schoolId: string;
  online: boolean;
  lastPingAt: string;
}
