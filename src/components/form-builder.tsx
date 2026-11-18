"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, FileInput, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { importFormFields, saveFormSchema, type ActionState, type ImportState } from "@/app/admin/actions";
import { FIELD_TYPE_LABELS, type FieldType, type FormField } from "@/lib/types";

type Draft = FormField & { optionsText: string };

const toDraft = (f: FormField): Draft => ({ ...f, optionsText: (f.options ?? []).join("\n") });

export function FormBuilder({ companyId, initial }: { companyId: string; initial: FormField[] }) {
  const [fields, setFields] = useState<Draft[]>(initial.map(toDraft));
  const [state, action, pending] = useActionState<ActionState, FormData>(saveFormSchema, undefined);
  const [dirty, setDirty] = useState(false);

  const applyImport = (imported: FormField[], mode: "append" | "replace") => {
    setFields((fs) => (mode === "replace" ? imported.map(toDraft) : [...fs, ...imported.map(toDraft)]));
    setDirty(true);
  };

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
    <div className="space-y-5">
    <FormImport onApply={applyImport} />
    <form action={action} onSubmit={() => setDirty(false)} className="space-y-3">
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
        <button className={`btn-primary ${dirty ? "ring-4 ring-brand-200" : ""}`} disabled={pending}>{pending ? "جاري..." : "حفظ الفورم"}</button>
        {dirty && !pending && <p className="text-sm font-semibold text-brand-700">الحقول اتضافت — راجعها ودوس «حفظ الفورم»</p>}
        {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
        {state?.ok && <p className="text-sm text-emerald-600">{state.ok}</p>}
      </div>
    </form>
    </div>
  );
}

const TYPE_NAME: Record<FieldType, string> = FIELD_TYPE_LABELS;

function FormImport({ onApply }: { onApply: (fields: FormField[], mode: "append" | "replace") => void }) {
  const [state, action, pending] = useActionState<ImportState, FormData>(importFormFields, undefined);
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<ImportState>();
  const preview = state?.fields && state !== applied ? state.fields : null;

  if (!open) {
    return (
      <button type="button" className="btn-dark w-full justify-start" onClick={() => setOpen(true)}>
        <Wand2 size={16} /> طبّق الفورم بتاعتك — الصق الأسئلة أو لينك Google Form
      </button>
    );
  }
  return (
    <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4">
      <form action={action} className="space-y-3">
        <label className="label flex items-center gap-2" htmlFor="form-source"><FileInput size={16} /> الفورم بتاعة الشركة</label>
        <textarea
          id="form-source"
          name="source"
          rows={6}
          className="input font-mono text-[13px] leading-6"
          placeholder={"الصق لينك Google Form، أو اكتب كل سؤال في سطر:\nنوع المركبة*: موتوسيكل، سكوتر، عربية\nالسن (رقم)*\nمعاه رخصة (نعم/لا)\nتاريخ الميلاد (تاريخ)\nخبرة سابقة (نص طويل)"}
        />
        <p className="text-xs leading-5 text-zinc-500">
          <b>*</b> = مطلوب · <b>سؤال: اختيار، اختيار</b> = قائمة اختيارات · <b>(رقم)</b> <b>(تاريخ)</b> <b>(نعم/لا)</b> <b>(موبايل)</b> <b>(نص طويل)</b> = نوع الحقل.
          الاسم والموبايل والمحافظة والمنطقة بيتشالوا لوحدهم لأنهم موجودين أصلاً.
        </p>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={pending}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} حوّلها لحقول
          </button>
          <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>إغلاق</button>
        </div>
        {state?.error && <p className="text-sm text-rose-600">{state.error}</p>}
      </form>

      {preview && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">لقيت {preview.length} حقل من {state?.source}:</p>
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">
            {preview.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-semibold">{f.label}</span>
                {f.required && <span className="badge bg-rose-50 text-rose-700">مطلوب</span>}
                <span className="badge bg-zinc-100 text-zinc-600">{TYPE_NAME[f.type]}</span>
                {f.options && <span className="text-xs text-zinc-500">{f.options.join(" · ")}</span>}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={() => { onApply(preview, "append"); setApplied(state); }}>
              ضيفهم على الحقول الحالية
            </button>
            <button type="button" className="btn-ghost" onClick={() => { onApply(preview, "replace"); setApplied(state); }}>
              استبدل كل الحقول بيهم
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
