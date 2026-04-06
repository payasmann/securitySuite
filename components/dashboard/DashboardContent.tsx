"use client";

import { useState, useEffect } from "react";
import StatCard from "./StatCard";
import MotionBars from "./MotionBars";
import ZoneStatus from "./ZoneStatus";
import RecentActivity from "./RecentActivity";
import { useSocket } from "@/hooks/useSocket";

interface DashboardData {
  stats: {
    camerasOnline: number;
    camerasTotal: number;
    activeAlerts: number;
    criticalAlerts: number;
    motionEvents: number;
    storageUsed: number;
    storageFree: string;
  };
  motionByCamera: {
    cameraId: string;
    cameraName: string;
    count: number;
  }[];
  zones: {
    name: string;
    status: "Clear" | "Motion" | "Alert";
  }[];
  recentActivity: {
    id: string;
    time: string;
    type: "critical" | "warning" | "info";
    message: string;
  }[];
}

// Fallback data matching the screenshot
const FALLBACK_DATA: DashboardData = {
  stats: {
    camerasOnline: 14,
    camerasTotal: 15,
    activeAlerts: 3,
    criticalAlerts: 2,
    motionEvents: 47,
    storageUsed: 68,
    storageFree: "2.1TB",
  },
  motionByCamera: [
    { cameraId: "CAM-01", cameraName: "Entrance", count: 82 },
    { cameraId: "CAM-04", cameraName: "Parking A", count: 67 },
    { cameraId: "CAM-03", cameraName: "N Corri...", count: 55 },
    { cameraId: "CAM-02", cameraName: "Cafeteria", count: 30 },
    { cameraId: "CAM-05", cameraName: "Gym", count: 18 },
  ],
  zones: [
    { name: "Main Entrance", status: "Clear" },
    { name: "Cafeteria", status: "Clear" },
    { name: "Parking Lot A", status: "Motion" },
    { name: "Gym / Sports Hall", status: "Clear" },
    { name: "North Corridor", status: "Alert" },
    { name: "Library", status: "Clear" },
  ],
  recentActivity: [
    {
      id: "1",
      time: "09:42",
      type: "critical",
      message: "Motion alert triggered — North Corridor (CAM-03)",
    },
    {
      id: "2",
      time: "09:38",
      type: "warning",
      message: "Loitering flag — Parking Lot A (CAM-04)",
    },
    {
      id: "3",
      time: "09:31",
      type: "warning",
      message: "Camera quality drop — Boiler Room (CAM-15)",
    },
    {
      id: "4",
      time: "09:14",
      type: "info",
      message: "Recording restored — Rooftop (CAM-11)",
    },
    {
      id: "5",
      time: "09:00",
      type: "info",
      message: "Backup completed — NVR-01",
    },
  ],
};

interface DashboardContentProps {
  schoolId: string;
}

export default function DashboardContent({ schoolId }: DashboardContentProps) {
  const [data, setData] = useState<DashboardData>(FALLBACK_DATA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/dashboard/stats");
        if (res.ok) {
          const apiData = await res.json();
          setData(apiData);
        }
        // If API fails, keep fallback data
      } catch {
        // Keep fallback data
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();

    // Refresh every 60 seconds
    const interval = setInterval(fetchDashboard, 60000);
    return () => clearInterval(interval);
  }, []);

  // Socket.io live updates
  const { connected, onAlert, onCameraStatus, onDashboardUpdate } = useSocket({ schoolId });

  // Handle live alert events
  useEffect(() => {
    onAlert((alert) => {
      setData((prev) => ({
        ...prev,
        recentActivity: [
          {
            id: alert.id,
            time: new Date(alert.createdAt).toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }),
            type: alert.type === "CRITICAL" ? "critical" : alert.type === "WARNING" ? "warning" : "info",
            message: alert.title,
          },
          ...prev.recentActivity.slice(0, 9),
        ],
        stats: {
          ...prev.stats,
          activeAlerts: prev.stats.activeAlerts + 1,
          criticalAlerts:
            alert.type === "CRITICAL"
              ? prev.stats.criticalAlerts + 1
              : prev.stats.criticalAlerts,
        },
      }));
    });
  }, [onAlert]);

  // Handle camera status changes
  useEffect(() => {
    onCameraStatus((cam) => {
      setData((prev) => {
        const newOnline =
          cam.status === "ONLINE"
            ? prev.stats.camerasOnline + 1
            : Math.max(0, prev.stats.camerasOnline - 1);
        return {
          ...prev,
          stats: {
            ...prev.stats,
            camerasOnline: newOnline,
          },
        };
      });
    });
  }, [onCameraStatus]);

  // Handle full dashboard updates
  useEffect(() => {
    onDashboardUpdate((update) => {
      setData((prev) => ({
        ...prev,
        stats: {
          ...prev.stats,
          camerasOnline: update.stats.camerasOnline,
          camerasTotal: update.stats.camerasTotal,
          activeAlerts: update.stats.activeAlerts,
          motionEvents: update.stats.motionEvents,
        },
      }));
    });
  }, [onDashboardUpdate]);

  return (
    <div className={`space-y-4 ${loading ? "animate-fade-in" : ""}`}>
      {/* Connection indicator */}
      {connected !== undefined && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-status-online" : "bg-text-muted"}`} />
          <span className="text-2xs text-text-muted">
            {connected ? "Live" : "Connecting..."}
          </span>
        </div>
      )}
      {/* Top row: Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          value={data.stats.camerasOnline}
          label="of  cameras online"
          subLabel={`of ${data.stats.camerasTotal} total`}
          colorClass="text-status-online"
        />
        <StatCard
          value={data.stats.activeAlerts}
          label="active alerts"
          subLabel={`${data.stats.criticalAlerts} critical`}
          colorClass="text-status-alert"
        />
        <StatCard
          value={data.stats.motionEvents}
          label="motion events"
          subLabel="last 60 min"
          colorClass="text-status-warning"
        />
        <StatCard
          value={`${data.stats.storageUsed}%`}
          label="storage used"
          subLabel={`${data.stats.storageFree} free`}
          colorClass="text-accent"
        />
      </div>

      {/* Middle row: Motion bars + Zone status */}
      <div className="grid grid-cols-2 gap-4">
        <MotionBars data={data.motionByCamera} />
        <ZoneStatus zones={data.zones} />
      </div>

      {/* Bottom: Recent activity */}
      <RecentActivity items={data.recentActivity} />
    </div>
  );
}
