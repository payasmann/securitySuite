"use client";

import { useEffect, useState } from "react";

interface LiveFeedProps {
  cameraId: string;
  onError?: () => void;
}

export default function LiveFeed({ cameraId, onError }: LiveFeedProps) {
  const [connecting, setConnecting] = useState(true);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initStream() {
      try {
        const res = await fetch(`/api/stream/${cameraId}`);
        const data = await res.json();

        if (cancelled) return;

        if (!res.ok || data.remoteBlocked || data.bridgeOffline || data.cameraOffline) {
          onError?.();
          return;
        }

        if (data.stream?.url) {
          setStreamUrl(data.stream.url);
        }
      } catch {
        if (!cancelled) onError?.();
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }

    initStream();

    return () => {
      cancelled = true;
    };
  }, [cameraId, onError]);

  if (connecting) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-app">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-2xs text-text-muted">Connecting...</span>
        </div>
      </div>
    );
  }

  if (!streamUrl) {
    // Simulated feed placeholder — shows animated gradient
    return (
      <div className="absolute inset-0 bg-bg-app">
        <div className="w-full h-full bg-gradient-to-br from-bg-card to-bg-app opacity-50" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-2xs text-text-muted/50 font-mono">
            FEED: {cameraId.slice(0, 8)}
          </span>
        </div>
      </div>
    );
  }

  // When stream URL is available, render a video element for WebRTC
  // This is where you'd connect to MediaMTX via WHEP
  return (
    <div className="absolute inset-0 bg-black">
      <video
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
        ref={(video) => {
          if (video && streamUrl) {
            // WebRTC WHEP connection would go here
            // For now, just show the placeholder
          }
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xs text-text-muted/50 font-mono">
          LIVE
        </span>
      </div>
    </div>
  );
}
