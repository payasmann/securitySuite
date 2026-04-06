"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface SchoolData {
  id: string;
  name: string;
  slug: string;
  stats: {
    camerasOnline: number;
    camerasTotal: number;
    usersCount: number;
    alertsCount: number;
  };
  flags: {
    localStorage: boolean;
    cloudStorage: boolean;
    remoteAccess: boolean;
    localView: boolean;
  };
  streamBridge: {
    online: boolean;
    lastPingAt: string | null;
  } | null;
}

export default function OpsDashboardPage() {
  const [schools, setSchools] = useState<SchoolData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSchools() {
      try {
        const res = await fetch("/api/schools");
        if (res.ok) {
          const data = await res.json();
          setSchools(data.schools);
        }
      } catch {
        // keep empty
      } finally {
        setLoading(false);
      }
    }
    fetchSchools();
    const interval = setInterval(fetchSchools, 60000);
    return () => clearInterval(interval);
  }, []);

  const totalSchools = schools.length;
  const totalCamerasOnline = schools.reduce((sum, s) => sum + s.stats.camerasOnline, 0);
  const totalCameras = schools.reduce((sum, s) => sum + s.stats.camerasTotal, 0);
  const totalAlerts = schools.reduce((sum, s) => sum + s.stats.alertsCount, 0);
  const offlineBridges = schools.filter((s) => !s.streamBridge?.online).length;

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard value={totalSchools} label="Total Schools" colorClass="text-accent" />
        <StatCard
          value={totalCamerasOnline}
          label="Cameras Online"
          subLabel={`of ${totalCameras} total`}
          colorClass="text-status-online"
        />
        <StatCard
          value={totalAlerts}
          label="Active Alerts"
          colorClass={totalAlerts > 0 ? "text-status-alert" : "text-text-muted"}
        />
        <StatCard
          value={offlineBridges}
          label="Offline Bridges"
          colorClass={offlineBridges > 0 ? "text-status-warning" : "text-status-online"}
        />
      </div>

      {/* Schools table */}
      <div className="bg-bg-panel border border-border rounded-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            Schools Overview
          </h2>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-2.5">School</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-2.5">Cameras</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-2.5">Alerts</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-2.5">Bridge</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-2.5">Features</th>
              <th className="text-left text-2xs font-medium text-text-muted uppercase tracking-wider px-4 py-2.5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? [...Array(3)].map((_, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="skeleton h-4 w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              : schools.map((school) => (
                  <tr
                    key={school.id}
                    className="border-b border-border last:border-0 hover:bg-bg-hover/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="text-sm text-text-primary font-medium">{school.name}</div>
                      <div className="text-2xs text-text-muted font-mono">{school.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-mono ${school.stats.camerasOnline === school.stats.camerasTotal ? "text-status-online" : "text-status-warning"}`}>
                        {school.stats.camerasOnline}
                      </span>
                      <span className="text-xs text-text-muted">/{school.stats.camerasTotal}</span>
                    </td>
                    <td className="px-4 py-3">
                      {school.stats.alertsCount > 0 ? (
                        <span className="text-sm font-mono text-status-alert">{school.stats.alertsCount}</span>
                      ) : (
                        <span className="text-sm text-text-muted">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {school.streamBridge ? (
                        <span className={`inline-flex items-center gap-1.5 text-2xs ${school.streamBridge.online ? "text-status-online" : "text-status-alert"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${school.streamBridge.online ? "bg-status-online" : "bg-status-alert"}`} />
                          {school.streamBridge.online ? "Online" : "Offline"}
                        </span>
                      ) : (
                        <span className="text-2xs text-text-muted">Not configured</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <FlagDot active={school.flags.remoteAccess} label="R" />
                        <FlagDot active={school.flags.cloudStorage} label="C" />
                        <FlagDot active={school.flags.localView} label="L" />
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/ops/schools/${school.id}`}
                          className="text-2xs text-accent hover:text-accent-hover transition-colors"
                        >
                          Detail
                        </Link>
                        <Link
                          href={`/ops/schools/${school.id}/settings`}
                          className="text-2xs text-text-muted hover:text-text-secondary transition-colors"
                        >
                          Settings
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>

        {!loading && schools.length === 0 && (
          <div className="p-8 text-center text-text-muted text-sm">No schools configured</div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  subLabel,
  colorClass,
}: {
  value: number | string;
  label: string;
  subLabel?: string;
  colorClass: string;
}) {
  return (
    <div className="bg-bg-panel border border-border rounded-card p-4">
      <div className={`text-3xl font-bold tabular-nums ${colorClass}`}>{value}</div>
      <div className="text-xs text-text-muted mt-1">{label}</div>
      {subLabel && <div className="text-2xs text-text-muted mt-0.5">{subLabel}</div>}
    </div>
  );
}

function FlagDot({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={`w-5 h-5 rounded text-2xs font-mono flex items-center justify-center ${
        active
          ? "bg-status-online/10 text-status-online border border-status-online/20"
          : "bg-bg-card text-text-muted border border-border"
      }`}
      title={`${label}: ${active ? "Enabled" : "Disabled"}`}
    >
      {label}
    </span>
  );
}
