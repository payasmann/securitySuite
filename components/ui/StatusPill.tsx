import { type ReactNode } from "react";

type PillVariant = "online" | "alert" | "warning" | "info" | "muted";

interface StatusPillProps {
  variant: PillVariant;
  children: ReactNode;
  dot?: boolean;
}

const variantStyles: Record<PillVariant, string> = {
  online: "bg-status-online/10 text-status-online border-status-online/20",
  alert: "bg-status-alert/10 text-status-alert border-status-alert/20",
  warning: "bg-status-warning/10 text-status-warning border-status-warning/20",
  info: "bg-accent/10 text-accent border-accent/20",
  muted: "bg-bg-card text-text-muted border-border",
};

const dotStyles: Record<PillVariant, string> = {
  online: "bg-status-online",
  alert: "bg-status-alert",
  warning: "bg-status-warning",
  info: "bg-accent",
  muted: "bg-text-muted",
};

export default function StatusPill({ variant, children, dot = true }: StatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${variantStyles[variant]}`}
    >
      {dot && (
        <span className={`w-1.5 h-1.5 rounded-full ${dotStyles[variant]}`} />
      )}
      {children}
    </span>
  );
}
