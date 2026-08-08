/** Formatting shared by server and client. Keep it dependency-free. */

/** 0 → "0:00", 3875 → "1:04:35". Trip-relative, which is how every stage clocks. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * "48s" · "1m 17s" · "42m" · "1h 35m" — for durations rather than positions.
 *
 * Seconds are kept below 10 minutes on purpose: moments run 60–140s, and rounding
 * to whole minutes made a 77s moment and a 135s moment both read "1m", which is
 * the one comparison the card and the panel exist to support.
 */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 600) {
    const rem = s % 60;
    return rem ? `${Math.floor(s / 60)}m ${rem}s` : `${Math.floor(s / 60)}m`;
  }
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "32 min into the trip" — how you actually describe when you last saw something. */
export function intoTrip(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return "at the very start";
  if (m < 60) return `${m} min in`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m in` : `${h}h in`;
}

/** How long before the trip ended — "you left it 30 min before the end". */
export function beforeEnd(seconds: number, durationSec: number): string {
  const m = Math.round((durationSec - seconds) / 60);
  if (m < 1) return "right at the end";
  return `${m} min before the end`;
}

export function distance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function clockTime(isoStart: string, offsetSec = 0): string {
  const d = new Date(new Date(isoStart).getTime() + offsetSec * 1000);
  return d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

export function tripDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
