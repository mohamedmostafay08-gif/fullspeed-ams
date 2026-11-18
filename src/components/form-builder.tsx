"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { saveFormSchema, type ActionState } from "@/app/admin/actions";
import { FIELD_TYPE_LABELS, type FieldType, type FormField } from "@/lib/types";

type Draft = FormField & { optionsText: string };

const toDraft = (f: FormField): Draft => ({ ...f, optionsText: (f.options ?? []).join("\n") });

export function FormBuilder({ companyId, initial }: { companyId: string; initial: FormField[] }) {
  const [fields, setFields] = useState<Draft[]>(initial.map(toDraft));
  const [state, action, pending] = useActionState<ActionState, FormData>(saveFormSchema, undefined);

  const update = (i: number, patch: Partial<Draft>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const next = [...fs];
      const j = i + d;
      if (j < 0 || j >= next.length) return fs;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const schema = JSON.stringify(
    fields.map(({ optionsText, ...f }) => ({
      ...f,
      options: f.type === "select" ? optionsText.split("\n").map((o) => o.trim()).filter(Boolean) : undefined,
    })),
  );

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={companyId} />
      <input type="hidden" name="schema" value={schema} />
      <p className="text-sm text-zinc-500">
        الاسم والموبايل والمحافظة والمنطقة موجودين في كل الفورمز تلقائياً — ضيف هنا الحقول الخاصة بالشركة دي بس.
      </p>
      {fields.map((f, i) => (
        <div key={i} className="grid gap-2 rounded-xl border border-zinc-200 p-3 sm:grid-cols-[1fr_10rem_auto]">
          <input className="input" placeholder="اسم الحقل (مثلاً: نوع المركبة)" value={f.label} onChange={(e) => update(i, { label: e.target.value })} />
          <select className="input" value={f.type} onChange={(e) => update(i, { type: e.target.value as FieldType })}>
            {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-1 px-2 text-xs">
              <input type="checkbox" checked={Boolean(f.required)} onChange={(e) => update(i, { required: e.target.checked })} /> مطلوب
            </label>
            <button type="button" className="rounded p-1.5 hover:bg-zinc-100" onClick={() => move(i, -1)} aria-label="لفوق"><ArrowUp size={16} /></button>
            <button type="button" className="rounded p-1.5 hover:bg-zinc-100" onClick={() => move(i, 1)} aria-label="لتحت"><ArrowDown size={16} /></button>
            <button type="button" className="rounded p-1.5 text-rose-600 hover:bg-rose-50" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} aria-label="حذف"><Trash2 size={16} /></button>
          </div>
          {f.type === "select" && (
            <textarea
              className="input sm:col-span-3"
              rows={3}
              placeholder="الاختيارات — كل اختيار في سطر"
              value={f.optionsText}
              onChange={(e) => update(i, { optionsText: e.target.value })}
            />
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setFields((fs) => [...fs, { key: "", label: "", type: "text", required: false, optionsText: "" }])}
        >
          <Plus size={16} /> حقل جديد
        </button>
        <button className="btn-primary" disabled={pending}>{pending ? "جاري..." : "حفظ الفورم"}</button>
        {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      </div>
    </form>
  );
}
