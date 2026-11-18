"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

const LEADS = "#3b6fd8";
const HIRED = "#ea580c";

type Day = { day: string; leads: number; hired: number };

/** Paired daily bars (leads vs hired) on one count axis, with a hover tooltip per day. */
export function TrendChart({ data }: { data: Day[] }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 26, left: 32 };
  const max = Math.max(1, ...data.map((d) => Math.max(d.leads, d.hired)));
  const nice = Math.ceil(max / 5) * 5 || 5;
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(14, slot / 2 - 3));
  const y = (v: number) => pad.top + innerH - (v / nice) * innerH;
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(data.length / 10);
  const h = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <div className="mb-3 flex gap-4 text-xs font-semibold text-zinc-600">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: LEADS }} /> {t("ليدز جديدة")}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: HIRED }} /> {t("اشتغلوا")}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("الليدز والتعيينات يوم بيوم")} style={{ direction: "ltr" }} onMouseLeave={() => setHover(null)}>
        {ticks.map((row) => (
          <g key={row}>
            <line x1={pad.left} x2={W - pad.right} y1={y(row)} y2={y(row)} stroke="#e4e4e7" strokeWidth={1} />
            <text x={pad.left - 6} y={y(row) + 4} textAnchor="end" fontSize="10" fill="#71717a">{row}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.left + i * slot + slot / 2;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill={hover === i ? "#f4f4f5" : "transparent"} />
              {d.leads > 0 && <rect x={x0 - barW - 1} y={y(d.leads)} width={barW} height={Math.max(1, y(0) - y(d.leads))} rx={3} fill={LEADS} />}
              {d.hired > 0 && <rect x={x0 + 1} y={y(d.hired)} width={barW} height={Math.max(1, y(0) - y(d.hired))} rx={3} fill={HIRED} />}
              {i % labelEvery === 0 && (
                <text x={x0} y={H - 8} textAnchor="middle" fontSize="10" fill="#71717a">{d.day.slice(5)}</text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="#a1a1aa" strokeWidth={1} />
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg">
          <p className="num mb-1 text-slate-ink">{h.day}</p>
          <p>{t("ليدز:")} <b className="num">{h.leads}</b> {t("· اشتغلوا:")} <b className="num">{h.hired}</b></p>
        </div>
      )}
    </div>
  );
}

/** Single-series horizontal bars for a ranked breakdown. */
export function BarList({ rows, valueLabel }: { rows: { label: string; value: number; sub?: string }[]; valueLabel?: string }) {
  const t = useT();
  const unit = valueLabel ?? t("ليد");
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value} ${unit}`}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">{r.label}</span>
            <span className="num shrink-0 text-xs text-zinc-500">
              {r.value}
              {r.sub && <span className="text-zinc-400"> · {r.sub}</span>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: LEADS }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
