"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface SchoolDetail {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  ipRange: string | null;
  cameras: Array<{
    id: string;
    cameraId: string;
    name: string;
    zone: string;
    type: string;
    resolution: string;
    status: string;
    lastSeenAt: string | null;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
  }>;
  alerts: Array<{
    id: string;
    type: string;
    title: string;
    createdAt: string;
    camera: { cameraId: string; name: string } | null;
  }>;
  streamBridge: {
    online: boolean;
    lastPingAt: string | null;
    internalUrl: string;
    publicUrl: string | null;
  } | null;
}

export default function SchoolDetailPage() {
  const params = useParams();
  const schoolId = params.id as string;
  const [school, setSchool] = useState<SchoolDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSchool() {
      try {
        const res = await fetch(`/api/schools/${schoolId}`);
        if (res.ok) {
          const data = await res.json();
          setSchool(data.school);
        }
      } catch {
        // keep null
      } finally {
        setLoading(false);
      }
    }
    fetchSchool();
  }, [schoolId]);

  if (loading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="skeleton h-8 w-64" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card p-4">
              <div className="skeleton h-6 w-12 mb-2" />
              <div className="skeleton h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="card p-4">
          <div className="skeleton h-4 w-32 mb-4" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton h-4 w-full mb-2" />
          ))}
        </div>
      </div>
    );
  }

  if (!school) {
    return (
      <div className="card p-8 text-center text-text-muted">
        School not found
      </div>
    );
  }

  const camerasOnline = school.cameras.filter((c) => c.status === "ONLINE").length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">{school.name}</h1>
          <p className="text-xs text-text-muted font-mono">{school.slug}</p>
          {school.address && <p className="text-xs text-text-muted mt-0.5">{school.address}</p>}
        </div>
        <Link
          href={`/ops/schools/${schoolId}/settings`}
          className="px-3 py-1.5 text-xs bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 transition-colors text-accent"
        >
          Settings
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <MiniStat
          value={`${camerasOnline}/${school.cameras.length}`}
          label="Cameras"
          colorClass={camerasOnline === school.cameras.length ? "text-status-online" : "text-status-warning"}
        />
        <MiniStat
          value={school.alerts.length.toString()}
          label="Active Alerts"
          colorClass={school.alerts.length > 0 ? "text-status-alert" : "text-text-muted"}
        />
        <MiniStat
          value={school.users.filter((u) => u.active).length.toString()}
          label="Active Users"
          colorClass="text-accent"
        />
        <MiniStat
          value={school.streamBridge?.online ? "Online" : "Offline"}
          label="Stream Bridge"
          colorClass={school.streamBridge?.online ? "text-status-online" : "text-status-alert"}
        />
      </div>

      {/* Cameras table */}
      <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Cameras</h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-2xs font-medium text-text-muted uppercase px-4 py-2">ID</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase px-4 py-2">Name</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase px-4 py-2">Zone</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase px-4 py-2">Type</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {school.cameras.map((cam) => (
              <tr key={cam.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-mono text-xs text-text-secondary">{cam.cameraId}</td>
                <td className="px-4 py-2 text-sm text-text-primary">{cam.name}</td>
                <td className="px-4 py-2 text-xs text-text-muted">{cam.zone}</td>
                <td className="px-4 py-2 text-xs text-text-muted">{cam.type}</td>
                <td className="px-4 py-2">
                  <span className={`inline-flex items-center gap-1.5 text-2xs ${
                    cam.status === "ONLINE" ? "text-status-online" : cam.status === "WARNING" ? "text-status-warning" : "text-status-alert"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      cam.status === "ONLINE" ? "bg-status-online" : cam.status === "WARNING" ? "bg-status-warning" : "bg-status-alert"
                    }`} />
                    {cam.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Active alerts */}
      {school.alerts.length > 0 && (
        <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Active Alerts</h2>
          </div>
          <div className="divide-y divide-border">
            {school.alerts.map((alert) => (
              <div key={alert.id} className="px-4 py-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  alert.type === "CRITICAL" ? "bg-status-alert" : alert.type === "WARNING" ? "bg-status-warning" : "bg-accent"
                }`} />
                <span className="text-sm text-text-primary">{alert.title}</span>
                {alert.camera && (
                  <span className="font-mono text-2xs text-text-muted">{alert.camera.cameraId}</span>
                )}
                <span className="text-2xs text-text-muted ml-auto font-mono">
                  {new Date(alert.createdAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Users */}
      <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider">Users ({school.users.length})</h2>
        </div>
        <div className="divide-y divide-border">
          {school.users.map((user) => (
            <div key={user.id} className="px-4 py-2.5 flex items-center gap-3">
              <span className={`w-1.5 h-1.5 rounded-full ${user.active ? "bg-status-online" : "bg-text-muted"}`} />
              <span className="text-sm text-text-primary">{user.name}</span>
              <span className="text-xs text-text-muted font-mono">{user.email}</span>
              <span className="text-2xs text-text-muted ml-auto">
                {user.role.replace(/_/g, " ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MiniStat({ value, label, colorClass }: { value: string; label: string; colorClass: string }) {
  return (
    <div className="bg-bg-panel border border-border rounded-card p-3">
      <div className={`text-xl font-bold tabular-nums ${colorClass}`}>{value}</div>
      <div className="text-2xs text-text-muted mt-0.5">{label}</div>
    </div>
  );
}
