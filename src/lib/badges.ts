export type AgentStats = {
  total_leads: number;
  total_hired: number;
  streak: number;
  calls_today: number;
  avg_first_touch_min: number | null;
  leads_7d: number;
};

export type Badge = { key: string; icon: string; label: string; hint: string; earned: boolean; progress?: [number, number] };

/** Badge rules (Arabic text = translation keys). */
export function badgesFor(s: AgentStats, rankToday: number | null, pointsToday: number): Badge[] {
  const fast = s.avg_first_touch_min != null && s.leads_7d >= 5 && s.avg_first_touch_min <= 30;
  const step = (key: string, icon: string, label: string, hint: string, value: number, goal: number): Badge => ({
    key, icon, label, hint, earned: value >= goal, progress: [Math.min(value, goal), goal],
  });
  return [
    step("first_hire", "🥇", "أول تعيين", "عيّن أول كابتن", s.total_hired, 1),
    step("hire_10", "🚀", "10 تعيينات", "عيّن 10 كباتن", s.total_hired, 10),
    step("hire_50", "👑", "50 تعيين", "عيّن 50 كابتن", s.total_hired, 50),
    step("leads_100", "📈", "100 ليد", "سجّل 100 ليد", s.total_leads, 100),
    step("streak_3", "🔥", "3 أيام ورا بعض", "حقق هدفك 3 أيام متتالية", s.streak, 3),
    step("streak_7", "⚡", "أسبوع نار", "حقق هدفك 7 أيام متتالية", s.streak, 7),
    step("calls_50", "📞", "ماكينة مكالمات", "50 مكالمة في يوم واحد", s.calls_today, 50),
    { key: "fast", icon: "⏱️", label: "سريع الرد", hint: "متوسط أول رد أقل من 30 دقيقة (آخر 7 أيام)", earned: fast },
    { key: "top", icon: "🏆", label: "الأول النهارده", hint: "خليك رقم 1 في ترتيب النهارده", earned: rankToday === 1 && pointsToday > 0 },
  ];
}

export type BoardRow = {
  agent_id: string;
  full_name: string;
  team_id: string | null;
  leads: number;
  calls: number;
  interviews: number;
  hired: number;
  points: number;
  streak: number;
};
