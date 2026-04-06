"use client";

import { useState, useEffect } from "react";

interface TopbarProps {
  schoolName: string;
  systemOnline?: boolean;
}

export default function Topbar({ schoolName, systemOnline = true }: TopbarProps) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    function updateTime() {
      const now = new Date();
      setTime(
        now.toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    }

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-topbar bg-bg-panel border-b border-border flex items-center justify-between px-5">
      {/* Left: Brand + School Name */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-text-primary tracking-wide">
          SAFEGUARD
        </span>
        <span className="text-sm text-text-muted">
          {schoolName}
        </span>
      </div>

      {/* Right: System status + Clock */}
      <div className="flex items-center gap-4">
        {/* System status */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              systemOnline
                ? "bg-status-online animate-pulse-slow"
                : "bg-status-alert"
            }`}
          />
          <span className="text-xs text-text-secondary">
            {systemOnline ? "All systems live" : "System issue detected"}
          </span>
        </div>

        {/* Live clock */}
        <div className="font-mono text-xs text-text-muted bg-bg-app px-2.5 py-1 rounded border border-border tabular-nums min-w-[72px] text-center">
          {time || "--:--:--"}
        </div>
      </div>
    </header>
  );
}
