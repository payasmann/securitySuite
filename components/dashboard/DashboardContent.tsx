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

// Empty initial data — real data comes from the API
const INITIAL_DATA: DashboardData = {
  stats: {
    camerasOnline: 0,
    camerasTotal: 0,
    activeAlerts: 0,
    criticalAlerts: 0,
    motionEvents: 0,
    storageUsed: 0,
    storageFree: "0GB",
  },
  motionByCamera: [],
  zones: [],
  recentActivity: [],
};

interface DashboardContentProps {
  schoolId: string;
}

export default function DashboardContent({ schoolId }: DashboardContentProps) {
  const [data, setData] = useState<DashboardData>(INITIAL_DATA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/dashboard/stats");
        if (res.ok) {
          const apiData = await res.json();
          setData(apiData);
        }
      } catch {
        // Keep current data on error
      } finally {
        setLoading(false);
      }
    }

    fetchDashboard();
    const interval = setInterval(fetchDashboard, 60000);
    return () => clearInterval(interval);
  }, []);

  // Socket.io live updates
  const { connected, onAlert, onCameraStatus, onDashboardUpdate, onMotionDetected } = useSocket({ schoolId });

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

  // Handle real-time motion detected events
  useEffect(() => {
    onMotionDetected((motion) => {
      setData((prev) => {
        // Increment motion events counter
        const newMotionEvents = prev.stats.motionEvents + 1;

        // Update motionByCamera: find existing entry or add new one
        const updatedMotionByCamera = [...prev.motionByCamera];
        const existingIdx = updatedMotionByCamera.findIndex(
          (entry) => entry.cameraId === motion.cameraId
        );

        if (existingIdx >= 0) {
          updatedMotionByCamera[existingIdx] = {
            ...updatedMotionByCamera[existingIdx],
            count: updatedMotionByCamera[existingIdx].count + 1,
          };
        } else {
          updatedMotionByCamera.push({
            cameraId: motion.cameraId,
            cameraName: motion.cameraName,
            count: 1,
          });
        }

        // Sort by count descending so the chart stays ordered
        updatedMotionByCamera.sort((a, b) => b.count - a.count);

        return {
          ...prev,
          stats: {
            ...prev.stats,
            motionEvents: newMotionEvents,
          },
          motionByCamera: updatedMotionByCamera,
        };
      });
    });
  }, [onMotionDetected]);

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
