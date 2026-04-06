"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface LiveFeedProps {
  cameraId: string;
  onError?: () => void;
}

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

type ConnectionState = "connecting" | "connected" | "error";

/**
 * Negotiate a WHEP session with MediaMTX.
 * Returns the RTCPeerConnection wired up with remote audio+video.
 */
async function connectWhep(
  whepUrl: string,
  iceServers: RTCIceServer[]
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({
    iceServers: iceServers.length > 0 ? iceServers : undefined,
  });

  // Request both audio and video from the server
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering to complete (or timeout after 2s)
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 2000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    };
  });

  const response = await fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription!.sdp,
  });

  if (!response.ok) {
    pc.close();
    throw new Error(`WHEP negotiation failed: ${response.status}`);
  }

  const answerSdp = await response.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return pc;
}

export default function LiveFeed({ cameraId, onError }: LiveFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [muted, setMuted] = useState(true);
  const [hasAudio, setHasAudio] = useState(false);
  const retriesRef = useRef(0);

  const cleanup = useCallback(() => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const connect = useCallback(async () => {
    cleanup();
    setState("connecting");

    try {
      // Fetch stream info from API
      const res = await fetch(`/api/stream/${cameraId}`);
      const data = await res.json();

      if (!res.ok || data.remoteBlocked || data.bridgeOffline || data.cameraOffline) {
        throw new Error(data.message || "Stream unavailable");
      }

      // Support both new format (whepUrl) and legacy format (stream.url)
      const whepUrl: string | undefined = data.whepUrl || data.stream?.url;
      const iceServers: RTCIceServer[] = data.iceServers || [];

      if (!whepUrl) {
        throw new Error("No WHEP URL in response");
      }

      const pc = await connectWhep(whepUrl, iceServers);
      pcRef.current = pc;

      // Wire up the media stream to the video element
      pc.ontrack = (event) => {
        if (!videoRef.current) return;

        if (!videoRef.current.srcObject) {
          videoRef.current.srcObject = new MediaStream();
        }
        const stream = videoRef.current.srcObject as MediaStream;
        stream.addTrack(event.track);

        if (event.track.kind === "audio") {
          setHasAudio(true);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setState("connected");
          retriesRef.current = 0;
        } else if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected"
        ) {
          handleRetry();
        }
      };

      // Fallback: if connection state doesn't fire, treat track arrival as connected
      // Give it a few seconds to establish
      setTimeout(() => {
        if (pcRef.current === pc && state === "connecting") {
          const stream = videoRef.current?.srcObject as MediaStream | null;
          if (stream && stream.getTracks().length > 0) {
            setState("connected");
            retriesRef.current = 0;
          }
        }
      }, 3000);
    } catch (err) {
      console.error(`[LiveFeed] Connection error for ${cameraId}:`, err);
      handleRetry();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, cleanup]);

  const handleRetry = useCallback(() => {
    retriesRef.current++;

    if (retriesRef.current > MAX_RETRIES) {
      setState("error");
      onError?.();
      return;
    }

    const delay = INITIAL_RETRY_DELAY * Math.pow(2, retriesRef.current - 1);
    console.log(
      `[LiveFeed] Retry ${retriesRef.current}/${MAX_RETRIES} for ${cameraId} in ${delay}ms`
    );

    setTimeout(() => {
      connect();
    }, delay);
  }, [cameraId, connect, onError]);

  useEffect(() => {
    connect();

    return () => {
      cleanup();
    };
  }, [connect, cleanup]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => !prev);
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  }, []);

  // --- Loading state ---
  if (state === "connecting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-app">
        <div className="flex flex-col items-center gap-2">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-2xs text-text-muted">Connecting...</span>
        </div>
      </div>
    );
  }

  // --- Error state ---
  if (state === "error") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-bg-app">
        <div className="flex flex-col items-center gap-2">
          <svg
            className="w-6 h-6 text-status-alert"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="text-2xs text-text-muted">
            Connection failed
          </span>
          <button
            onClick={() => {
              retriesRef.current = 0;
              connect();
            }}
            className="mt-1 px-2 py-0.5 text-2xs bg-bg-card text-text-secondary rounded-card border border-border hover:bg-bg-panel transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // --- Connected state ---
  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        playsInline
        muted={muted}
      />

      {/* Mute/unmute button — bottom-left, only shown if audio track exists */}
      {hasAudio && (
        <button
          onClick={toggleMute}
          className="absolute bottom-2 left-2 p-1.5 rounded-card bg-black/60 hover:bg-black/80 transition-colors"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? (
            /* Speaker muted icon */
            <svg
              className="w-4 h-4 text-text-muted"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
              />
            </svg>
          ) : (
            /* Speaker unmuted icon */
            <svg
              className="w-4 h-4 text-status-online"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728"
              />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
