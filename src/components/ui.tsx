import Image from "next/image";
import { Inbox, type LucideIcon } from "lucide-react";
import { CountUp } from "@/components/count-up";
import { Tr, When } from "@/components/tr";
import { LEAD_STATUS_COLORS, LEAD_STATUS_EMOJI, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

export function CompanyLogo({ name, src, size = 36 }: { name: string; src: string | null; size?: number }) {
  if (!src) {
    return (
      <span
        className="inline-grid shrink-0 place-items-center rounded-full bg-ink font-bold text-bone ring-1 ring-black/5"
        style={{ width: size, height: size, fontSize: size / 2.8 }}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return <Image src={src} alt={name} width={size} height={size} className="shrink-0 rounded-full bg-ink object-cover ring-1 ring-black/5" />;
}

type Tone = "default" | "good" | "brand" | "warn";
const TONE: Record<Tone, { icon: string; value: string }> = {
  default: { icon: "bg-zinc-100 text-zinc-600", value: "text-ink" },
  good: { icon: "bg-emerald-50 text-emerald-600", value: "text-emerald-700" },
  brand: { icon: "bg-brand-50 text-brand-600", value: "text-brand-700" },
  warn: { icon: "bg-amber-50 text-amber-600", value: "text-amber-700" },
};

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
  emoji,
  progress,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: LucideIcon;
  emoji?: string;
  progress?: { value: number; target: number };
}) {
  const t = TONE[tone];
  return (
    <div className="group card lift flex flex-col items-center gap-2 text-center">
      {emoji ? (
        <span aria-hidden className={`grid size-11 place-items-center rounded-2xl text-xl transition-transform duration-300 group-hover:scale-110 ${t.icon}`}>{emoji}</span>
      ) : Icon && (
        <span className={`grid size-11 place-items-center rounded-2xl transition-transform duration-300 group-hover:scale-110 ${t.icon}`}>
          <Icon size={20} />
        </span>
      )}
      <p className="text-sm font-semibold text-zinc-500">{label}</p>
      <p className={`num text-3xl font-semibold tracking-tight ${t.value}`}>{typeof value === "number" ? <CountUp value={value} /> : value}</p>
      {progress ? <div className="w-full"><Progress value={progress.value} target={progress.target} /></div> : hint && <p className="text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Progress({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : value > 0 ? 100 : 0;
  const color = target === 0 ? "bg-zinc-300" : pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-brand-500" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/6 dark:bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`bar-fill h-full rounded-full transition-[width] duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="num w-16 text-right rtl:text-left text-xs text-zinc-500" dir="ltr">
        {value}/{target || "—"}
      </span>
    </div>
  );
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span className={`badge ${LEAD_STATUS_COLORS[status]}`}>
      <span aria-hidden>{LEAD_STATUS_EMOJI[status]}</span>
      <Tr text={LEAD_STATUS_LABELS[status]} />
    </span>
  );
}

export function Empty({ children, icon: Icon = Inbox }: { children: React.ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-6 py-10 text-center text-sm text-zinc-500">
      <span className="grid size-10 place-items-center rounded-full bg-white text-zinc-400 ring-1 ring-zinc-200">
        <Icon size={18} />
      </span>
      <div>{children}</div>
    </div>
  );
}

/** Rendered date in the viewer's language (Cairo time). */
export function formatDate(iso: string | null) {
  return <When iso={iso} />;
}
