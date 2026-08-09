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

/**
 * The UTC offset baked into an ISO 8601 string, in minutes. `null` if it has none.
 *
 * This is what lets a trip render in ITS OWN local time rather than the viewer's.
 * A walk through Kyoto started at 05:50 +09:00, and it has to read as "5:50 AM"
 * whether you open it from Ontario or from Lisbon — otherwise the album titled
 * "Higashiyama at first light" shows times in the middle of the night.
 */
function offsetMinutesOf(iso: string): number | null {
  const m = /(?:Z|([+-])(\d{2}):?(\d{2}))$/.exec(iso.trim());
  if (!m) return null;
  if (!m[1]) return 0; // trailing "Z"
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * Shift an instant into the trip's own wall clock, then read it as if it were UTC.
 *
 * Returns a Date whose getUTC* accessors give the trip-local calendar values.
 */
function inTripZone(isoStart: string, offsetSec: number): Date {
  const offsetMin = offsetMinutesOf(isoStart) ?? 0;
  return new Date(new Date(isoStart).getTime() + offsetSec * 1000 + offsetMin * 60_000);
}

/** "3:18 PM", in the trip's local time — not the viewer's. */
export function clockTime(isoStart: string, offsetSec = 0): string {
  return inTripZone(isoStart, offsetSec).toLocaleTimeString("en-CA", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** "19:42" — the trip's wall clock in 24h, compact enough for a specimen tag. */
export function clockShort(isoStart: string, offsetSec = 0): string {
  const d = inTripZone(isoStart, offsetSec);
  return `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** Hour of day, 0–23, in the trip's local time. Drives the album's time sections. */
export function tripLocalHour(isoStart: string, offsetSec = 0): number {
  return inTripZone(isoStart, offsetSec).getUTCHours();
}

export function tripDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * "Aug 2" — compact, for anywhere a date sits inside a dense line of metadata.
 *
 * The year only appears when it is not the current one. Stamping "2026" on every
 * row of a library that is mostly one year is noise; its absence is the signal.
 */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * "Aug 2026" — the date overlaid on an album tile.
 *
 * Always carries the year, unlike `monthLabel`. A tile is read on its own rather
 * than under a group header, so "August" with no year is genuinely ambiguous
 * once the library spans more than one.
 */
export function tileDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

/** "August" · "November 2025" — month grouping, where the year is contextual. */
export function monthLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", {
    month: "long",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
