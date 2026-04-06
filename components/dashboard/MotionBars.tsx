interface MotionBarData {
  cameraId: string;
  cameraName: string;
  count: number;
}

interface MotionBarsProps {
  data: MotionBarData[];
}

function getBarColor(index: number, total: number): string {
  if (total <= 1) return "bg-status-alert";
  const ratio = index / (total - 1);
  if (ratio < 0.3) return "bg-status-alert";
  if (ratio < 0.5) return "bg-status-warning";
  if (ratio < 0.7) return "bg-yellow-500";
  return "bg-accent";
}

export default function MotionBars({ data }: MotionBarsProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="bg-bg-panel border border-border rounded-card p-4">
      <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider mb-4">
        Motion by Camera
      </h3>

      <div className="space-y-3">
        {data.map((item, index) => (
          <div key={item.cameraId} className="flex items-center gap-3">
            {/* Camera label */}
            <div className="w-28 flex-shrink-0 truncate">
              <span className="font-mono text-2xs text-text-muted">
                {item.cameraId}
              </span>
              <span className="text-2xs text-text-muted ml-1 hidden sm:inline">
                {item.cameraName.length > 8
                  ? item.cameraName.slice(0, 8) + "..."
                  : item.cameraName}
              </span>
            </div>

            {/* Bar */}
            <div className="flex-1 h-3.5 bg-bg-app rounded overflow-hidden">
              <div
                className={`h-full rounded transition-all duration-500 ${getBarColor(index, data.length)}`}
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>

            {/* Count */}
            <span className="text-xs text-text-secondary tabular-nums w-8 text-right font-mono">
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
