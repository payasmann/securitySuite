interface StatCardProps {
  value: number | string;
  label: string;
  subLabel?: string;
  colorClass: string; // e.g. "text-status-online", "text-status-alert"
}

export default function StatCard({ value, label, subLabel, colorClass }: StatCardProps) {
  return (
    <div className="bg-bg-panel border border-border rounded-card p-4">
      <div className={`text-3xl font-bold tabular-nums ${colorClass}`}>
        {value}
      </div>
      <div className="text-xs text-text-muted mt-1">
        {label}
      </div>
      {subLabel && (
        <div className="text-2xs text-text-muted mt-0.5">
          {subLabel}
        </div>
      )}
    </div>
  );
}
