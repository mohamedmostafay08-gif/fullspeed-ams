"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

const LEADS = "var(--chart-leads)";
const HIRED = "var(--chart-hired)";

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
            <line x1={pad.left} x2={W - pad.right} y1={y(row)} y2={y(row)} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
            <text x={pad.left - 6} y={y(row) + 4} textAnchor="end" fontSize="10" style={{ fill: "var(--chart-label)" }}>{row}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.left + i * slot + slot / 2;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} style={{ fill: hover === i ? "var(--chart-hover)" : "transparent" }} />
              {d.leads > 0 && <rect x={x0 - barW - 1} y={y(d.leads)} width={barW} height={Math.max(1, y(0) - y(d.leads))} rx={3} style={{ fill: LEADS }} />}
              {d.hired > 0 && <rect x={x0 + 1} y={y(d.hired)} width={barW} height={Math.max(1, y(0) - y(d.hired))} rx={3} style={{ fill: HIRED }} />}
              {i % labelEvery === 0 && (
                <text x={x0} y={H - 8} textAnchor="middle" fontSize="10" style={{ fill: "var(--chart-label)" }}>{d.day.slice(5)}</text>
              )}
            </g>
          );
        })}
        <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} style={{ stroke: "var(--chart-axis)" }} strokeWidth={1} />
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

const SERIES = ["var(--chart-leads)", "var(--chart-hired)", "#8b5cf6", "#14b8a6"];

/** Several lines over the same weeks, to compare people, teams or companies side by side. */
export function LinesChart({ labels, series, unit }: { labels: string[]; series: { name: string; values: number[] }[]; unit?: string }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 240;
  const pad = { top: 12, right: 12, bottom: 26, left: 34 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const nice = Math.ceil(max / 5) * 5 || 5;
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (labels.length <= 1 ? innerW / 2 : (i * innerW) / (labels.length - 1));
  const y = (v: number) => pad.top + innerH - (v / nice) * innerH;
  return (
    <div className="relative">
      <div className="mb-3 flex flex-wrap gap-4 text-xs font-semibold text-zinc-600">
        {series.map((s, i) => (
          <span key={s.name} className="flex items-center gap-1.5"><span className="h-1 w-4 rounded-full" style={{ background: SERIES[i % SERIES.length] }} /> {s.name}</span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("مقارنة أسبوع بأسبوع")} style={{ direction: "ltr" }} onMouseLeave={() => setHover(null)}>
        {[0, nice / 2, nice].map((row) => (
          <g key={row}>
            <line x1={pad.left} x2={W - pad.right} y1={y(row)} y2={y(row)} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
            <text x={pad.left - 6} y={y(row) + 4} textAnchor="end" fontSize="10" style={{ fill: "var(--chart-label)" }}>{row}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          <g key={l} onMouseEnter={() => setHover(i)}>
            <rect x={x(i) - innerW / Math.max(1, labels.length) / 2} y={pad.top} width={innerW / Math.max(1, labels.length)} height={innerH} style={{ fill: hover === i ? "var(--chart-hover)" : "transparent" }} />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" style={{ fill: "var(--chart-label)" }}>{l.slice(5)}</text>
          </g>
        ))}
        {series.map((s, si) => (
          <g key={s.name}>
            <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: SERIES[si % SERIES.length] }} />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={hover === i ? 4.5 : 3} style={{ fill: SERIES[si % SERIES.length] }} />)}
          </g>
        ))}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg">
          <p className="num mb-1 text-slate-ink">{t("أسبوع {0}", labels[hover])}</p>
          {series.map((s) => <p key={s.name}>{s.name}: <b className="num">{s.values[hover]}</b>{unit ? ` ${unit}` : ""}</p>)}
        </div>
      )}
    </div>
  );
}
