"use client";

import { useT } from "@/lib/i18n/client";

/** Ticks or clears every `name="user_id"` checkbox that belongs to the given form. */
export function SelectAllBox({ form }: { form: string }) {
  const t = useT();
  return (
    <input
      type="checkbox"
      aria-label={t("علّم على الكل")}
      className="accent-brand-600"
      onChange={(e) => {
        document.querySelectorAll<HTMLInputElement>(`input[name="user_id"][form="${form}"]`).forEach((el) => {
          el.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}
