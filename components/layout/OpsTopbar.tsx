"use client";

import { useState, useEffect } from "react";

export default function OpsTopbar() {
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
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-text-primary tracking-wide">
          SAFEGUARD
        </span>
        <span className="px-1.5 py-0.5 bg-status-warning/10 text-status-warning text-2xs font-medium rounded">
          OPS
        </span>
        <span className="text-sm text-text-muted">Operations Portal</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-status-online animate-pulse-slow" />
          <span className="text-xs text-text-secondary">Systems monitored</span>
        </div>
        <div className="font-mono text-xs text-text-muted bg-bg-app px-2.5 py-1 rounded border border-border tabular-nums min-w-[72px] text-center">
          {time || "--:--:--"}
        </div>
      </div>
    </header>
  );
}
