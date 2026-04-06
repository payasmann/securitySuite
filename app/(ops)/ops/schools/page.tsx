"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface SchoolListItem {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  stats: {
    camerasOnline: number;
    camerasTotal: number;
    usersCount: number;
    alertsCount: number;
  };
  limits: {
    retentionDays: number;
    maxCameras: number;
    maxUsers: number;
  };
  streamBridge: {
    online: boolean;
    lastPingAt: string | null;
  } | null;
  createdAt: string;
}

export default function SchoolsListPage() {
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
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
  }, []);

  return (
    <div>
      <h1 className="text-lg font-semibold text-text-primary mb-4">
        All Schools
        <span className="text-sm font-normal text-text-muted ml-2">{schools.length} total</span>
      </h1>

      <div className="grid gap-4">
        {loading
          ? [...Array(3)].map((_, i) => (
              <div key={i} className="card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="skeleton h-5 w-48 mb-2" />
                    <div className="skeleton h-3 w-32" />
                  </div>
                  <div className="skeleton h-8 w-20 rounded" />
                </div>
              </div>
            ))
          : schools.map((school) => (
              <div
                key={school.id}
                className="bg-bg-panel border border-border rounded-card p-5 hover:border-border-hover transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-text-primary">{school.name}</h3>
                    <p className="text-2xs text-text-muted font-mono mt-0.5">{school.slug}</p>
                    {school.address && (
                      <p className="text-xs text-text-muted mt-1">{school.address}</p>
                    )}

                    <div className="flex items-center gap-4 mt-3">
                      <div className="text-xs">
                        <span className="text-status-online font-mono">{school.stats.camerasOnline}</span>
                        <span className="text-text-muted">/{school.stats.camerasTotal} cameras</span>
                      </div>
                      <div className="text-xs">
                        <span className="text-text-secondary font-mono">{school.stats.usersCount}</span>
                        <span className="text-text-muted"> users</span>
                      </div>
                      {school.stats.alertsCount > 0 && (
                        <div className="text-xs">
                          <span className="text-status-alert font-mono">{school.stats.alertsCount}</span>
                          <span className="text-text-muted"> alerts</span>
                        </div>
                      )}
                      <div className="text-xs">
                        {school.streamBridge ? (
                          <span className={school.streamBridge.online ? "text-status-online" : "text-status-alert"}>
                            Bridge {school.streamBridge.online ? "online" : "offline"}
                          </span>
                        ) : (
                          <span className="text-text-muted">No bridge</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/ops/schools/${school.id}`}
                      className="px-3 py-1.5 text-xs bg-bg-card border border-border rounded hover:border-border-hover transition-colors text-text-secondary"
                    >
                      View
                    </Link>
                    <Link
                      href={`/ops/schools/${school.id}/settings`}
                      className="px-3 py-1.5 text-xs bg-accent/10 border border-accent/20 rounded hover:bg-accent/20 transition-colors text-accent"
                    >
                      Settings
                    </Link>
                  </div>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
