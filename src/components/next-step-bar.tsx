import { ListChecks, PhoneCall } from "lucide-react";
import { CallButton } from "@/components/call-timer";
import { WhatsAppMenu } from "@/components/whatsapp-menu";
import { getT } from "@/lib/i18n/server";
import type { Template, TemplateVars } from "@/lib/whatsapp";

/** Bottom of the lead page: what to do next, and the buttons to do it. Stays on screen while scrolling. */
export async function NextStepBar({ step, closed, leadId, name, phone, templates, vars }: {
  step: { text: string; urgent: boolean };
  closed: boolean;
  leadId: string;
  name: string;
  phone: string;
  templates: Template[];
  vars: TemplateVars;
}) {
  const t = await getT();
  return (
    // Pinned above the phone tab bar on small screens.
    <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+88px)] z-20 mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-(--card-edge) bg-(--card) p-2.5 shadow-[0_12px_40px_-12px_rgba(11,16,32,0.35)] md:bottom-4">
      <div className="flex min-w-0 flex-1 basis-full items-center sm:basis-40 gap-2.5 px-1">
        <ListChecks size={18} className={`shrink-0 ${step.urgent ? "text-rose-600" : "text-zinc-400"}`} />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-500">{t("الخطوة الجاية")}</p>
          <p className={`line-clamp-2 text-sm font-bold ${step.urgent ? "text-rose-700" : ""}`}>{step.text}</p>
        </div>
      </div>
      {!closed && <a href="#outcome" className="btn-ghost hidden sm:inline-flex">{t("سجّل النتيجة")}</a>}
      <WhatsAppMenu leadId={leadId} phone={phone} templates={templates} vars={vars} up />
      <CallButton leadId={leadId} name={name} phone={phone} className="btn-primary flex-1 justify-center sm:flex-none">
        <PhoneCall size={17} /> {t("اتصل")}
      </CallButton>
    </div>
  );
}
