"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trophy, X } from "lucide-react";
import { celebrate, playSound, vibrate } from "@/lib/fx";
import { useT } from "@/lib/i18n/client";

/** Fires once per day per agent when today's leads or hiring target is reached. */
export function TargetCelebration({ userId, day, leads, leadsTarget, hired, hiredTarget }: {
  userId: string;
  day: string;
  leads: number;
  leadsTarget: number;
  hired: number;
  hiredTarget: number;
}) {
  const t = useT();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const hits: [string, boolean, string][] = [
      ["hired", hiredTarget > 0 && hired >= hiredTarget, "حققت تارجت التعيين النهارده!"],
      ["leads", leadsTarget > 0 && leads >= leadsTarget, "حققت تارجت الليدز النهارده!"],
    ];
    const seen = (kind: string) => {
      try {
        return !!localStorage.getItem(`fs-target-${userId}-${day}-${kind}`);
      } catch {
        return true;
      }
    };
    const fresh = hits.filter(([kind, hit]) => hit && !seen(kind));
    if (fresh.length === 0) return;
    // One celebration covers every target reached since the last visit.
    const id = setTimeout(() => {
      try {
        for (const [kind, hit] of hits) if (hit) localStorage.setItem(`fs-target-${userId}-${day}-${kind}`, "1");
      } catch {}
      setMsg(fresh.length > 1 ? "حققت كل التارجت بتاعك النهارده!" : fresh[0][2]);
      celebrate();
      playSound("target");
      vibrate([150, 80, 150, 80, 300]);
    }, 600);
    return () => clearTimeout(id);
  }, [userId, day, leads, leadsTarget, hired, hiredTarget]);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(id);
  }, [msg]);

  if (!msg) return null;
  return createPortal(
    <div role="status" className="fixed inset-x-0 top-6 z-[60] flex justify-center px-4">
      <div className="flex animate-zoom-in items-center gap-3 rounded-2xl bg-gradient-to-l from-emerald-500 to-emerald-600 px-5 py-4 text-white shadow-2xl shadow-emerald-600/40">
        <span className="grid size-11 animate-bounce-in place-items-center rounded-full bg-white/20">
          <Trophy size={24} />
        </span>
        <div>
          <p className="text-lg font-extrabold">{t(msg)}</p>
          <p className="text-sm text-white/85">{t("عاش يا بطل — كمّل كده 🔥")}</p>
        </div>
        <button onClick={() => setMsg(null)} className="ms-2 rounded-lg p-1 text-white/80 hover:bg-white/15" aria-label={t("إغلاق")}>
          <X size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
