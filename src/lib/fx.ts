"use client";

/**
 * Feedback effects: synthesized sounds (no audio files), vibration and confetti.
 * Everything is best-effort: unsupported browsers and reduced-motion users get a quiet no-op.
 */

export type Sound = "notify" | "lead" | "bonus" | "hire" | "target" | "tap";

const MUTE_KEY = "fs-mute";

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

const muteListeners = new Set<() => void>();
export function subscribeMuted(cb: () => void) {
  muteListeners.add(cb);
  return () => void muteListeners.delete(cb);
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {}
  muteListeners.forEach((cb) => cb());
}

let ctx: AudioContext | null = null;
function audio() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture; unlock on the first interaction.
if (typeof window !== "undefined") {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** [frequency Hz, start offset s, duration s] */
type Note = [number, number, number];
const SONGS: Record<Sound, { notes: Note[]; wave: OscillatorType; gain: number }> = {
  tap: { notes: [[880, 0, 0.05]], wave: "sine", gain: 0.05 },
  notify: { notes: [[784, 0, 0.12], [1047, 0.1, 0.18]], wave: "sine", gain: 0.12 },
  lead: { notes: [[659, 0, 0.1], [880, 0.09, 0.1], [1319, 0.18, 0.22]], wave: "triangle", gain: 0.12 },
  bonus: {
    notes: [[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.12], [1047, 0.3, 0.35], [1319, 0.42, 0.45]],
    wave: "square",
    gain: 0.05,
  },
  hire: { notes: [[392, 0, 0.12], [523, 0.11, 0.12], [659, 0.22, 0.12], [784, 0.33, 0.4]], wave: "triangle", gain: 0.14 },
  target: {
    notes: [[523, 0, 0.1], [784, 0.08, 0.1], [1047, 0.16, 0.1], [784, 0.26, 0.1], [1047, 0.34, 0.1], [1568, 0.44, 0.5]],
    wave: "square",
    gain: 0.05,
  },
};

export function playSound(sound: Sound) {
  if (isMuted()) return;
  const ac = audio();
  if (!ac) return;
  const { notes, wave, gain } = SONGS[sound];
  const now = ac.currentTime + 0.01;
  for (const [freq, at, dur] of notes) {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, now + at);
    g.gain.linearRampToValueAtTime(gain, now + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
    osc.connect(g).connect(ac.destination);
    osc.start(now + at);
    osc.stop(now + at + dur + 0.05);
  }
}

export function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

export function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const COLORS = ["#f97316", "#fb8a3c", "#3b6fd8", "#10b981", "#facc15", "#ec4899", "#ffffff"];

/** Canvas confetti burst from the given origin (0–1 of the viewport); cleans itself up. */
export function confetti({ count = 140, x = 0.5, y = 0.35, spread = 1 }: { count?: number; x?: number; y?: number; spread?: number } = {}) {
  if (typeof document === "undefined" || reducedMotion()) return;
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  const c = canvas.getContext("2d");
  if (!c) return canvas.remove();
  c.scale(dpr, dpr);

  const parts = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9 * spread;
    const speed = 7 + Math.random() * 9;
    return {
      x: W * x,
      y: H * y,
      vx: Math.cos(angle) * speed * (0.6 + Math.random()),
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6,
      h: 3 + Math.random() * 5,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < 0.3,
    };
  });

  const start = performance.now();
  const frame = (now: number) => {
    const elapsed = now - start;
    c.clearRect(0, 0, W, H);
    const fade = Math.max(0, 1 - Math.max(0, elapsed - 1800) / 900);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      c.save();
      c.globalAlpha = fade;
      c.translate(p.x, p.y);
      c.rotate(p.r);
      c.fillStyle = p.color;
      if (p.round) {
        c.beginPath();
        c.arc(0, 0, p.h, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      }
      c.restore();
    }
    if (elapsed < 2700) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

/** Two side cannons — for the big moments (target reached, bonus). */
export function celebrate() {
  confetti({ x: 0.15, y: 0.75, count: 110, spread: 0.7 });
  confetti({ x: 0.85, y: 0.75, count: 110, spread: 0.7 });
}
