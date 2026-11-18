/** Instant placeholder shown while a page's data streams in (keeps navigation feeling immediate). */
export function PageSkeleton() {
  const bar = "animate-pulse rounded-xl bg-zinc-200/70";
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-6">
      <div className="space-y-2">
        <div className={`${bar} h-8 w-48`} />
        <div className={`${bar} h-4 w-32`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card space-y-4">
            <div className={`${bar} h-4 w-24`} />
            <div className={`${bar} h-8 w-16`} />
            <div className={`${bar} h-1.5 w-full`} />
          </div>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card space-y-3 xl:col-span-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className={`${bar} size-9 shrink-0 rounded-full`} />
              <div className={`${bar} h-4 flex-1`} />
            </div>
          ))}
        </div>
        <div className="card space-y-3">
          <div className={`${bar} h-5 w-28`} />
          <div className={`${bar} h-24 w-full`} />
        </div>
      </div>
    </div>
  );
}
