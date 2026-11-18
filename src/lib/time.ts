// Cairo wall-clock helpers usable on server and client (Egypt observes DST, so offsets vary).

export const CAIRO = "Africa/Cairo";

function offsetAt(instant: Date): string {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName")?.value;
  return name?.replace("GMT", "") || "+02:00";
}

/** "2026-11-18T14:30" as read on a Cairo clock → ISO instant, or null when malformed. */
export function cairoLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const guess = new Date(`${local}:00Z`);
  const d = new Date(`${local}:00${offsetAt(guess)}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Instant → "YYYY-MM-DDTHH:mm" on the Cairo clock (for datetime-local inputs). */
export function toCairoLocal(date: Date | string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Short Cairo time like "14:30" / "2:30 م". */
export function cairoTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", { timeZone: CAIRO, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/** Day + time, e.g. "18 Nov, 14:30". */
export function cairoDateTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-EG", {
    timeZone: CAIRO,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
