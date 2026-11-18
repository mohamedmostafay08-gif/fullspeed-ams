import Image from "next/image";
import { LEAD_STATUS_COLORS, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";

export function CompanyLogo({ name, src, size = 36 }: { name: string; src: string | null; size?: number }) {
  if (!src) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-zinc-200 font-bold text-zinc-600"
        style={{ width: size, height: size, fontSize: size / 2.6 }}
      >
        {name.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return <Image src={src} alt={name} width={size} height={size} className="shrink-0 rounded-full bg-black object-cover" />;
}

export function StatCard({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: string; tone?: "default" | "good" | "brand" }) {
  const toneCls = tone === "good" ? "text-emerald-600" : tone === "brand" ? "text-brand-600" : "text-ink";
  return (
    <div className="card">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${toneCls}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}

export function Progress({ value, target }: { value: number; target: number }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : value > 0 ? 100 : 0;
  const color = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-brand-500" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 text-left text-xs tabular-nums text-zinc-500" dir="ltr">
        {value} / {target || "—"}
      </span>
    </div>
  );
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return <span className={`badge ${LEAD_STATUS_COLORS[status]}`}>{LEAD_STATUS_LABELS[status]}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500">{children}</p>;
}

export function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ar-EG", { timeZone: "Africa/Cairo", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
