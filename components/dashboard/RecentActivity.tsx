interface ActivityItem {
  id: string;
  time: string; // formatted time string HH:MM
  type: "critical" | "warning" | "info";
  message: string;
}

interface RecentActivityProps {
  items: ActivityItem[];
}

function getDotColor(type: ActivityItem["type"]): string {
  switch (type) {
    case "critical":
      return "bg-status-alert";
    case "warning":
      return "bg-status-warning";
    case "info":
      return "bg-text-muted";
  }
}

export default function RecentActivity({ items }: RecentActivityProps) {
  return (
    <div className="bg-bg-panel border border-border rounded-card p-4">
      <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-4">
        Recent Activity
      </h3>

      <div className="space-y-2.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-3">
            {/* Timestamp */}
            <span className="font-mono text-xs text-text-muted tabular-nums flex-shrink-0 w-10">
              {item.time}
            </span>

            {/* Dot */}
            <div className="flex-shrink-0 mt-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${getDotColor(item.type)}`} />
            </div>

            {/* Message */}
            <p className="text-sm text-text-secondary leading-snug">
              {item.message}
            </p>
          </div>
        ))}

        {items.length === 0 && (
          <p className="text-sm text-text-muted py-4 text-center">
            No recent activity
          </p>
        )}
      </div>
    </div>
  );
}
