import Link from "next/link";

const BIG_TONE = { plain: "", good: "text-emerald-700", warn: "text-amber-700", bad: "text-rose-700" } as const;

/** One of the three headline numbers: big figure, short label, one line of context. */
export function BigNumber({ href, label, value, sub, tone }: { href?: string; label: string; value: number; sub: string; tone: keyof typeof BIG_TONE }) {
  const body = (
    <>
      <p className="text-xs leading-snug font-semibold text-zinc-500 sm:text-[13px]">{label}</p>
      <p className={`num mt-1.5 text-[30px] leading-none sm:text-[40px] font-bold tracking-tight ${BIG_TONE[tone]}`}>{value}</p>
      <p className="mt-2 text-[11px] leading-snug text-zinc-500 sm:text-xs">{sub}</p>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-3 transition hover:-translate-y-0.5 sm:p-4 md:p-5">{body}</Link>
  ) : (
    <div className="card p-3 sm:p-4 md:p-5">{body}</div>
  );
}
