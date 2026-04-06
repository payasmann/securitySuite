export default function OpsLoading() {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-8 w-16 mb-2" />
            <div className="skeleton h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="card p-4">
        <div className="skeleton h-4 w-32 mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 mb-3">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
            <div className="skeleton h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
