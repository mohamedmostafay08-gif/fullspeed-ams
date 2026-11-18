export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`grid place-items-center rounded-xl bg-brand-600 text-white ${small ? "size-8" : "size-10"}`}>
      <svg viewBox="0 0 24 24" className={small ? "size-4" : "size-5"} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
        <path d="M4 17c4-1 6-3 7-6s3-5 9-6" />
        <circle cx="20" cy="5" r="1.6" fill="currentColor" stroke="none" />
        <path d="M3 21h7" opacity=".55" />
      </svg>
    </span>
  );
}
