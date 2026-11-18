import "server-only";

export type Coords = { lat: number; lng: number };

const PATTERNS = [
  /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/, // .../@30.09,31.32,17z
  /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/, // place data
  /[?&](?:q|query|ll|destination|center)=(-?\d{1,3}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
  /^\s*(-?\d{1,3}\.\d+)\s*[,،\s]\s*(-?\d{1,3}\.\d+)\s*$/, // "30.09, 31.32"
];

function match(text: string): Coords | null {
  for (const re of PATTERNS) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

const MAPS_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|www\.google\.[a-z.]+|google\.[a-z.]+)$/i;

/** Accepts "lat, lng", a full Google Maps URL, or a maps.app.goo.gl short link (followed server-side). */
export async function parseLocation(input: string): Promise<Coords | null> {
  const direct = match(input.trim());
  if (direct) return direct;

  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" || !MAPS_HOSTS.test(url.hostname)) return null;
    const found = match(decodeURIComponent(url.href));
    if (found) return found;
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(8000) }).catch(() => null);
    const next = res?.headers.get("location");
    if (!next) {
      const body = res && res.status === 200 ? await res.text().catch(() => "") : "";
      return match(body.slice(0, 200_000));
    }
    url = new URL(next, url);
  }
  return null;
}
