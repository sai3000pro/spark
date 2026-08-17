"use client";

/**
 * One clip, one row, and every affordance for telling it that it is wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ROW CLAIMS
 *
 * Only what `RoutedClip` carries, and it says which of the two it is every
 * time. A position read off a GPS fix and a position worked out from the clips
 * either side of it are the same two numbers on the screen, so the words and
 * the colour beside them are the only thing standing between a guess and a
 * measurement — see the rule at the top of lib/journey/clips.ts. `measured`,
 * `corrected`, `inferred` and `missing` therefore get four different sentences
 * and three different tones, and none of them is silent.
 *
 * A hole is printed as a hole. "not in the file" is a real answer about a real
 * file — most footage that has been through a messaging app has no location and
 * no capture time at all — and it is more useful than a plausible number
 * nobody can trace.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE REORDER IS TWO BUTTONS AND NOT A DRAG
 *
 * Drag-and-drop is the obvious gesture and the wrong one to build here: the
 * HTML5 API is a lot of code, it is inaccessible without a parallel keyboard
 * implementation, and it fails in exactly the situation this panel exists for —
 * someone showing the route to the person who walked it, on a laptop, once.
 * Two buttons are keyboard-native, screen-reader-native and cannot half-drop a
 * row onto the wrong index.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE MUTATES ANYTHING
 *
 * Every affordance emits a `ClipCorrection` upward and waits to be re-rendered
 * from a freshly derived route. That is what makes "reset this row" a two-line
 * function rather than an undo stack, and it is why a corrected value can still
 * be shown as corrected: the original reading is never overwritten, only
 * overruled. See the note on `ClipCorrection` in lib/journey/clips.ts.
 */
import { useState } from "react";

import {
  IMPLAUSIBLE_MPS,
  type ClipCorrection,
  type ClipSource,
  type RoutedClip,
} from "@/lib/journey/clips";
import { clockTime, distance, duration, formatBytes, shortDate } from "@/lib/format";

/**
 * What happened to this clip during a build, when one has been attempted.
 *
 * Lives here rather than in the panel because the row renders it, and because
 * `failed` has to be as visible as `built` — a nine-clip journey where clip
 * four's file was corrupt is still a journey, and the one thing that must not
 * happen is the row going quiet about it.
 */
export type ClipBuildStatus =
  | { state: "waiting" }
  | { state: "building"; line: string }
  | { state: "built"; tripId: string }
  | { state: "failed"; message: string };

interface Props {
  clip: RoutedClip;
  /** How many clips are in the route, so "3 of 9" can be said and the last row knows it is last. */
  total: number;
  /**
   * `describeCorrection` for every edit in play on this clip, in the order they
   * were made. Empty for an untouched row.
   */
  edits: string[];
  /** True while a build is running: corrections must not move under a running pipeline. */
  disabled: boolean;
  status?: ClipBuildStatus;
  onEdit: (edit: ClipCorrection) => void;
  onReset: (clipId: string) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing the two typed inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "43.6406, -79.4019" → a point, or a sentence saying why not.
 *
 * Range-checked here rather than at the far end on purpose: a latitude of 143
 * is not a routing problem to be reported later in a warning list, it is a typo
 * that the person is still looking at, and the fastest place to fix a typo is
 * beside the field that made it.
 */
function parseLatLng(raw: string): { lat: number; lng: number } | { error: string } {
  const parts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length !== 2) return { error: "two numbers, separated by a comma" };

  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { error: "those are not both numbers" };
  if (lat < -90 || lat > 90) return { error: `latitude ${lat} is off the earth — it runs −90 to 90` };
  if (lng < -180 || lng > 180) {
    return { error: `longitude ${lng} is off the earth — it runs −180 to 180` };
  }
  return { lat, lng };
}

/**
 * An instant, in the clip's OWN wall clock, for a `datetime-local` field.
 *
 * The input has no concept of a zone, so it has to be fed the local calendar
 * values the clip was filmed at — 7pm in Lisbon reads 19:00 whether this laptop
 * is in Ontario or not. Shifting by the stored offset and then reading the UTC
 * accessors is the same trick `inTripZone` uses in lib/format.ts.
 */
function localInputValue(iso: string | null, offsetMin: number | null): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + (offsetMin ?? -new Date(ms).getTimezoneOffset()) * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * The same journey back out: wall-clock text → ISO 8601 with an offset on it.
 *
 * The offset is the clip's own when the file stated one, so correcting the
 * minute of a clip filmed abroad does not silently drag it into this laptop's
 * timezone. When the file stated nothing there is no honest answer available,
 * so this computer's current offset is used and the field says so underneath —
 * an unlabelled guess here would sort the route wrongly and look correct doing it.
 */
function isoFromLocalInput(value: string, offsetMin: number | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const off = offsetMin ?? -new Date().getTimezoneOffset();
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${sign}${hh}:${mm}`;
}

// ─────────────────────────────────────────────────────────────────────────────

/** The four provenances, in words and in tone. Never collapsed to two. */
const SOURCE_WORDS: Record<ClipSource, string> = {
  measured: "read from the file",
  corrected: "you set this",
  inferred: "worked out from the clips either side",
  missing: "the file did not say",
};

/**
 * Four provenances, four tones, and `moss` reserved for the one that earned it.
 *
 * app/globals.css calls moss "the naturalist's seen-it-myself ink" and gives it
 * to the measured/live chip, so an inference wearing it here would be borrowing
 * the exact colour this codebase uses to mean "observed". Inference gets plain
 * ink instead: visible, unremarkable, and unmistakably not the fix colour.
 */
const SOURCE_TONE: Record<ClipSource, string> = {
  measured: "text-moss",
  corrected: "text-clay",
  inferred: "text-ink-soft",
  missing: "text-ink-faint",
};

function Source({ source }: { source: ClipSource }) {
  return (
    <span className={`fnote text-[9px] ${SOURCE_TONE[source]}`}>[ {SOURCE_WORDS[source]} ]</span>
  );
}

export function ClipRow({ clip, total, edits, disabled, status, onEdit, onReset }: Props) {
  const { facts, index } = clip;
  const [placeText, setPlaceText] = useState("");
  const [placeError, setPlaceError] = useState<string | null>(null);

  const applyPlace = () => {
    const parsed = parseLatLng(placeText);
    if ("error" in parsed) {
      // Rejected here, and nothing emitted — an out-of-range pin sent upward
      // would re-derive the whole route around a point that does not exist.
      setPlaceError(parsed.error);
      return;
    }
    setPlaceError(null);
    setPlaceText("");
    onEdit({ kind: "location", clipId: facts.id, location: parsed });
  };

  const speedIsSilly = clip.legSpeedMps !== null && clip.legSpeedMps > IMPLAUSIBLE_MPS;
  const inputId = `clip-${facts.id}`;

  return (
    <li
      className="rounded-[6px] bg-milk p-3"
      style={{ boxShadow: "var(--ring-ink)" }}
      aria-label={`clip ${index + 1} of ${total}, ${facts.name}`}
    >
      {/* ── Who this is, and where it sits ─────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="tnum text-[15px] leading-none text-ink-faint">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={`truncate text-[13.5px] ${
              clip.omitted ? "text-ink-faint line-through" : "text-ink"
            }`}
          >
            {facts.name}
          </span>
        </div>
        <span className="fnote text-[9px] text-ink-faint">
          [ {index + 1} of {total} · {formatBytes(facts.bytes)}
          {facts.durationSec !== null ? ` · ${duration(facts.durationSec)}` : " · length unknown"} ]
        </span>
      </div>

      {/* ── What the file said ─────────────────────────────────────────────── */}
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="fnote text-[9px] text-ink-faint">time</dt>
          <dd className="text-[12.5px] text-ink-soft">
            {clip.recordedAt ? (
              <>
                {shortDate(clip.recordedAt)} · {clockTime(clip.recordedAt)}
              </>
            ) : (
              <span className="text-ink-faint">not in the file</span>
            )}
          </dd>
          <Source source={clip.recordedAtSource} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="fnote text-[9px] text-ink-faint">place</dt>
          <dd className="tnum text-[12.5px] text-ink-soft">
            {clip.location ? (
              <>
                {clip.location.lat.toFixed(4)}, {clip.location.lng.toFixed(4)}
              </>
            ) : (
              <span className="text-ink-faint">not in the file</span>
            )}
          </dd>
          <Source source={clip.locationSource} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="fnote text-[9px] text-ink-faint">device</dt>
          <dd className="text-[12.5px] text-ink-soft">
            {facts.device ?? <span className="text-ink-faint">not in the file</span>}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="fnote text-[9px] text-ink-faint">from the one before</dt>
          <dd className="text-[12.5px] text-ink-soft">
            {index === 0 ? (
              <span className="text-ink-faint">this one starts the journey</span>
            ) : clip.legMetres === null && clip.legSeconds === null ? (
              <span className="text-ink-faint">nothing to measure it against</span>
            ) : (
              <>
                {clip.legMetres !== null ? distance(clip.legMetres) : "distance unknown"}
                {clip.legSeconds !== null ? ` · ${duration(clip.legSeconds)}` : " · gap unknown"}
              </>
            )}
          </dd>
        </div>
      </dl>

      {/* The number that catches a mis-ordering. Loud, because the honest
          response to "you travelled at 400 m/s" is to show the two rows and let
          the person who was there look at them — not to quietly reorder their
          afternoon. */}
      {speedIsSilly && clip.legSpeedMps !== null && (
        <p className="fnote mt-1.5 text-[9.5px] leading-relaxed text-clay">
          [ that leg implies {Math.round(clip.legSpeedMps)} m/s · over {IMPLAUSIBLE_MPS} m/s, so
          either these two are out of order or one of the timestamps is wrong ]
        </p>
      )}

      {/* ── What happened to it in the build ───────────────────────────────── */}
      {status && (
        <p
          className={`fnote mt-1.5 text-[9.5px] leading-relaxed ${
            status.state === "failed"
              ? "text-clay"
              : status.state === "built"
                ? "text-moss"
                : "text-ink-faint"
          }`}
        >
          [{" "}
          {status.state === "waiting"
            ? "waiting its turn"
            : status.state === "building"
              ? status.line
              : status.state === "built"
                ? "built"
                : `did not build · ${status.message}`}{" "}
          ]
        </p>
      )}

      {/* ── Telling it that it is wrong ────────────────────────────────────── */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || index === 0}
          onClick={() => onEdit({ kind: "order", clipId: facts.id, toIndex: index - 1 })}
          className="pill-ghost px-2.5 py-1 text-[11.5px] text-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden>↑</span> move up
        </button>
        <button
          type="button"
          disabled={disabled || index >= total - 1}
          onClick={() => onEdit({ kind: "order", clipId: facts.id, toIndex: index + 1 })}
          className="pill-ghost px-2.5 py-1 text-[11.5px] text-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden>↓</span> move down
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEdit({ kind: "omit", clipId: facts.id, omitted: !clip.omitted })}
          className={`pill-ghost px-2.5 py-1 text-[11.5px] disabled:opacity-40 ${
            clip.omitted ? "text-clay" : "text-ink-soft"
          }`}
        >
          {clip.omitted ? "put this one back" : "leave this one out"}
        </button>
      </div>

      {/* Typed corrections. Both are ordinary labelled inputs rather than a map
          and a picker: this panel is a route editor, not a mapping tool, and a
          pair of coordinates pasted out of Photos or Maps is the shortest path
          from "the app put this in the wrong street" to a fixed route. */}
      <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
        <div>
          <label
            htmlFor={`${inputId}-place`}
            className="fnote block text-[9px] text-ink-faint"
          >
            set the place · lat, lng
          </label>
          <div className="mt-1 flex items-center gap-1.5">
            <input
              id={`${inputId}-place`}
              type="text"
              inputMode="text"
              disabled={disabled}
              value={placeText}
              placeholder="43.6406, -79.4019"
              onChange={(e) => {
                setPlaceText(e.target.value);
                if (placeError) setPlaceError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPlace();
                }
              }}
              className="tnum w-[13.5rem] rounded-[4px] bg-milk px-2 py-1 text-[12px] text-ink disabled:opacity-40"
              style={{ boxShadow: "var(--ring-ink)" }}
            />
            <button
              type="button"
              disabled={disabled || !placeText.trim()}
              onClick={applyPlace}
              className="pill-ghost px-2.5 py-1 text-[11.5px] text-ink-soft disabled:opacity-40"
            >
              set place
            </button>
          </div>
          {placeError && (
            <p className="fnote mt-1 text-[9px] text-clay">[ {placeError} ]</p>
          )}
        </div>

        <div>
          <label htmlFor={`${inputId}-time`} className="fnote block text-[9px] text-ink-faint">
            set the time
            {facts.utcOffsetMin === null && " · read as this computer's clock"}
          </label>
          <input
            id={`${inputId}-time`}
            type="datetime-local"
            disabled={disabled}
            value={localInputValue(clip.recordedAt, facts.utcOffsetMin)}
            onChange={(e) => {
              const iso = isoFromLocalInput(e.target.value, facts.utcOffsetMin);
              if (iso) onEdit({ kind: "time", clipId: facts.id, recordedAt: iso });
            }}
            className="tnum mt-1 rounded-[4px] bg-milk px-2 py-1 text-[12px] text-ink disabled:opacity-40"
            style={{ boxShadow: "var(--ring-ink)" }}
          />
        </div>
      </div>

      {/* Every overruling, in the words the corrections module chose for it,
          with the way back. The original reading was never overwritten, so
          "reset" really does return to what the file said. */}
      {edits.length > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {edits.map((line, i) => (
            <span key={`${line}-${i}`} className="fnote text-[9.5px] text-clay">
              [ {line} ]
            </span>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onReset(facts.id)}
            className="fnote text-[9.5px] text-ink-faint underline-offset-4 hover:text-ink hover:underline disabled:opacity-40"
          >
            [ reset this row ]
          </button>
        </div>
      )}
    </li>
  );
}
