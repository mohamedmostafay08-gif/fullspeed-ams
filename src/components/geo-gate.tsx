"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, MapPinOff, RefreshCw } from "lucide-react";
import { checkIn, type CheckInResult } from "@/app/actions/geo";

type State = { kind: "idle" | "locating" | "checking" } | { kind: "denied" } | { kind: "unsupported" } | { kind: "result"; result: CheckInResult };

export function GeoGate({ locationName }: { locationName: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });

  const locate = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ kind: "unsupported" });
      return;
    }
    setState({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setState({ kind: "checking" });
        const result = await checkIn(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        if (result.ok) router.refresh();
        else setState({ kind: "result", result });
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? { kind: "denied" } : { kind: "result", result: { ok: false, reason: "error" } }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }, [router]);

  useEffect(() => {
    const t = setTimeout(locate, 0);
    return () => clearTimeout(t);
  }, [locate]);

  const busy = state.kind === "idle" || state.kind === "locating" || state.kind === "checking";
  const failed = state.kind === "result" ? state.result : null;

  return (
    <div className="mx-auto mt-6 max-w-md animate-rise text-center">
      <div className="card flex flex-col items-center gap-4 p-8">
        <span className={`grid size-16 place-items-center rounded-full ${busy ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600"}`}>
          {busy ? <MapPin size={30} /> : <MapPinOff size={30} />}
        </span>
        <div>
          <h1 className="text-xl font-extrabold">تأكيد مكان الشغل</h1>
          <p className="mt-1 text-sm text-zinc-500">
            السيستم بيفتح معاك من فرع <b className="text-ink">{locationName}</b> بس.
          </p>
        </div>

        {busy && (
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-700">
            <Loader2 size={16} className="animate-spin" /> {state.kind === "checking" ? "بنتأكد من مكانك..." : "بنحدد مكانك..."}
          </p>
        )}
        {state.kind === "denied" && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            لازم تسمح للمتصفح يعرف مكانك: دوس على علامة القفل جنب العنوان ← Location ← Allow، وبعدين جرّب تاني.
          </p>
        )}
        {state.kind === "unsupported" && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">المتصفح ده مش بيدعم تحديد المكان — استخدم Chrome.</p>}
        {failed?.reason === "far" && (
          <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
            إنت على بعد <b className="num">{failed.distance}</b> متر من {failed.location} — لازم تكون في حدود <span className="num">{failed.radius}</span> متر.
          </p>
        )}
        {failed?.reason === "accuracy" && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">تحديد المكان مش دقيق كفاية — شغّل الـ GPS / Location في الجهاز وجرّب تاني.</p>
        )}
        {failed?.reason === "error" && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">مقدرناش نحدد مكانك — جرّب تاني.</p>}

        {!busy && (
          <button className="btn-primary w-full" onClick={locate}>
            <RefreshCw size={16} /> جرّب تاني
          </button>
        )}
        <p className="text-xs text-zinc-400">لو بتشتغل من مكان تاني النهارده، كلم المدير يفتحلك من أي مكان.</p>
      </div>
    </div>
  );
}
