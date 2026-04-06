export default function SchoolLoading() {
  return (
    <div className="animate-fade-in">
      {/* Stat cards skeleton */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card p-4">
            <div className="skeleton h-8 w-16 mb-2" />
            <div className="skeleton h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Middle row skeleton */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="card p-4">
          <div className="skeleton h-4 w-32 mb-4" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 mb-3">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-4 flex-1" />
            </div>
          ))}
        </div>
        <div className="card p-4">
          <div className="skeleton h-4 w-24 mb-4" />
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center justify-between mb-3">
              <div className="skeleton h-3 w-28" />
              <div className="skeleton h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>

      {/* Activity skeleton */}
      <div className="card p-4">
        <div className="skeleton h-4 w-32 mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 mb-3">
            <div className="skeleton h-3 w-10" />
            <div className="skeleton h-2 w-2 rounded-full" />
            <div className="skeleton h-3 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}
