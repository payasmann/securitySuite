interface ZoneData {
  name: string;
  status: "Clear" | "Motion" | "Alert";
}

interface ZoneStatusProps {
  zones: ZoneData[];
}

function getStatusPill(status: ZoneData["status"]) {
  switch (status) {
    case "Clear":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-status-online/10 text-status-online border border-status-online/20">
          <span className="w-1.5 h-1.5 rounded-full bg-status-online" />
          Clear
        </span>
      );
    case "Motion":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-status-warning/10 text-status-warning border border-status-warning/20">
          <span className="w-1.5 h-1.5 rounded-full bg-status-warning" />
          Motion
        </span>
      );
    case "Alert":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-status-alert/10 text-status-alert border border-status-alert/20">
          <span className="w-1.5 h-1.5 rounded-full bg-status-alert" />
          Alert
        </span>
      );
  }
}

export default function ZoneStatus({ zones }: ZoneStatusProps) {
  return (
    <div className="bg-bg-panel border border-border rounded-card p-4">
      <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-4">
        Zone Status
      </h3>

      <div className="space-y-3">
        {zones.map((zone) => (
          <div
            key={zone.name}
            className="flex items-center justify-between py-1"
          >
            <span className="text-sm text-text-secondary">{zone.name}</span>
            {getStatusPill(zone.status)}
          </div>
        ))}
      </div>
    </div>
  );
}
