"use client";

import { Printer } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function PrintButton() {
  const t = useT();
  return (
    <button type="button" onClick={() => window.print()} className="btn-dark no-print">
      <Printer size={17} /> {t("طباعة / PDF")}
    </button>
  );
}
