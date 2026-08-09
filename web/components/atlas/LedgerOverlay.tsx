"use client";

/**
 * The ledger — the map plate's summary lines, opened to a full page.
 *
 * A page of the journal given over to the day's accounting: the figures up
 * top, then the instruments (the day traced as a detection ridge, the
 * moving-vs-stopped split, the cameras' attention by family), then the soft
 * numbers no pedometer keeps — who came along, what got the biggest laugh,
 * the day's moods and the music they earned — and finally the log, one line
 * per kept moment, each line a door back into its splat.
 *
 * Everything printed here is DERIVED server-side (lib/walkLedger.ts): laughs
 * off the audio track, pauses off the odometry, the trigger census off stage
 * 2's own candidates. The page draws no conclusions of its own.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { clockShort, clockTime, compactNumber, distance, duration, tripDate } from "@/lib/format";
import { inkForMoment } from "@/lib/theme";
import type { TripView } from "@/lib/tripData";
import type { LedgerRow, WalkLedger } from "@/lib/walkLedger";
import type { TriggerKind } from "@/lib/types";

interface Props {
  trip: TripView;
  ledger: WalkLedger;
  onClose: () => void;
  /** A log row is a door — close the ledger, open the moment. */
  onOpenMoment: (id: string) => void;
}

/** How stage 2's trigger kinds read when written out in the journal's voice. */
const TRIGGER_PHRASE: Record<TriggerKind, string> = {
  novel_object: "a new thing",
  face_count: "faces",
  dwell: "you stopped",
  audio_energy: "the sound rose",
  laughter: "laughter",
  speech_keyword: "a phrase",
  scene_change: "the scene turned",
};

export function LedgerOverlay({ trip, ledger, onClose, onOpenMoment }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { movement, perception, company, mood, log } = ledger;
  const clock = (t: number) => clockShort(trip.startedAt, t);

  return (
    <div
      className="fixed inset-0 z-40 overflow-hidden bg-paper text-ink"
      role="dialog"
      aria-modal="true"
      aria-label="The walk's ledger"
      style={{ animation: "takeover 0.34s var(--ease-signature) both", transformOrigin: "8% 6%" }}
    >
      {/* The close pill floats over the page so it never scrolls away. */}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="pill-ghost absolute right-4 top-4 z-30 bg-vellum/85 px-3.5 py-2 text-[13px] text-ink sm:right-5 sm:top-5"
      >
        Back to the map
        <kbd className="fnote rounded-[3px] px-1.5 py-0.5 text-[10px] text-ink-faint" style={{ boxShadow: "var(--ring-ink)" }}>
          esc
        </kbd>
      </button>

      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-5xl px-5 pb-16 pt-6 sm:px-8">
          {/* ── Masthead — set straight into the page, like the globe's ───── */}
          {/* pr clears the floating close pill until the page is wide enough. */}
          <header className="rise-in pr-36 sm:pr-0">
            <div className="flex items-baseline gap-2.5">
              <span className="font-display text-[26px] leading-none" style={{ fontWeight: 580 }}>
                Spark<span className="text-clay">.</span>
              </span>
              <span className="fnote text-[10px] text-ink-soft">[ the walk&apos;s ledger ]</span>
            </div>
            <h1 className="font-display mt-3 text-[28px] leading-tight sm:text-[34px]" style={{ fontWeight: 580 }}>
              {trip.title}
            </h1>
            <p className="tag tnum mt-1.5 text-[13px] text-ink-soft">
              {tripDate(trip.startedAt)} · {trip.placeLabel}, {trip.region} ·{" "}
              {clockTime(trip.startedAt)} – {clockTime(trip.startedAt, trip.durationSec)}
            </p>
          </header>

          {/* ── 01 · the figures ──────────────────────────────────────────── */}
          <Section n="01" title="the day in figures" i={1}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-3 lg:grid-cols-6">
              <Figure value={distance(trip.stats.distanceM)} label="walked" detail={`${(movement.avgMovingMps * 3.6).toFixed(1)} km/h on the move`} />
              <Figure value={duration(trip.stats.durationSec)} label="out the door" detail={`${duration(movement.pausedSec)} of it standing still`} />
              <Figure value={String(trip.stats.momentCount)} label="moments kept" detail={`of ${trip.stats.candidateCount} the robot weighed`} />
              <Figure value={String(company.people.length)} label="companions" detail={company.speakers.length > 0 ? `${company.speakers.length} voices heard` : "a quiet walk"} />
              <Figure value={String(company.laughT.length)} label="laughs caught" detail={company.laughT.length > 0 ? `the first at ${clock(company.laughT[0])}` : "the mic waits"} />
              <Figure value={String(trip.stats.distinctObjectCount)} label="kinds of thing seen" detail={`${compactNumber(trip.stats.detectionCount)} sightings in all`} />
            </div>
          </Section>

          {/* ── 02 · the ridge — the day traced by the cameras ────────────── */}
          <Section n="02" title="the day, measured" i={2}>
            <DayRidge trip={trip} ledger={ledger} onOpenMoment={onOpenMoment} />
          </Section>

          <div className="grid gap-x-12 lg:grid-cols-2">
            {/* ── 03 · movement ───────────────────────────────────────────── */}
            <Section n="03" title="the moving & the stopping" i={3}>
              <SplitBar movingSec={movement.movingSec} pausedSec={movement.pausedSec} />
              <p className="tag mt-4 text-[12.5px] leading-relaxed text-ink-soft">
                {movement.stops.length} real stops — a pause only makes the ledger past 45
                seconds; the rest is just traffic.
              </p>
              <ul className="mt-3 space-y-1.5">
                {movement.stops.map((s, i) => (
                  <li key={i} className="tag tnum flex items-baseline gap-3 text-[12.5px]">
                    <span className="fnote w-[44px] shrink-0 text-[10px] text-ink-faint">{clock(s.t)}</span>
                    <span className="w-[58px] shrink-0 text-ink">{duration(s.durationSec)}</span>
                    <span className="min-w-0 truncate text-ink-soft">
                      {s.label ?? "somewhere along the way"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>

            {/* ── 04 · perception ─────────────────────────────────────────── */}
            <Section n="04" title="what the cameras noticed" i={3}>
              <p className="tag tnum text-[12.5px] leading-relaxed text-ink-soft">
                <strong className="font-semibold text-ink">{compactNumber(trip.stats.detectionCount)}</strong> raw sightings
                {" → "}
                <strong className="font-semibold text-ink">{trip.stats.candidateCount}</strong> windows flagged
                {" → "}
                <strong className="font-semibold text-ink">{trip.stats.momentCount}</strong> kept
                <span className="text-ink-faint"> · {perception.discardedCount} weighed and let go</span>
              </p>

              <FamilyBars families={perception.families} />

              <p className="fnote mt-6 text-[9px] text-ink-faint">[ what earned the keeps ]</p>
              <p className="tag mt-1.5 text-[12.5px] leading-relaxed text-ink-soft">
                {perception.triggers.map((t, i) => (
                  <span key={t.kind}>
                    {i > 0 && <span className="text-ink-faint"> · </span>}
                    <span className="whitespace-nowrap">
                      {TRIGGER_PHRASE[t.kind]}{" "}
                      <span className="tnum text-ink-faint">×{t.count}</span>
                    </span>
                  </span>
                ))}
              </p>
            </Section>

            {/* ── 05 · company & talk ─────────────────────────────────────── */}
            <Section n="05" title="the company & the talk" i={4}>
              <div className="flex flex-wrap gap-2">
                {company.people.map((p) => (
                  <span key={p.name} className="chip tag text-[12px]">
                    <strong className="font-semibold text-ink">{p.name}</strong>
                    <span className="tnum">
                      in {p.moments} of {trip.stats.momentCount} · from {clock(p.firstMetT)}
                    </span>
                  </span>
                ))}
              </div>

              <p className="tag tnum mt-4 text-[12.5px] leading-relaxed text-ink-soft">
                <strong className="font-semibold text-ink">{company.wordCount.toLocaleString("en-CA")}</strong> words across{" "}
                <strong className="font-semibold text-ink">{company.segmentCount}</strong> lines, {company.speakers.length} voices
                {company.laughT.length > 0 && (
                  <span className="text-ink-faint">
                    {" "}· laughter at {company.laughT.map((t) => clock(t)).join(", ")}
                  </span>
                )}
              </p>

              {company.bestLine && (
                <figure className="mt-5">
                  <p className="fnote text-[9px] text-ink-faint">[ the line before the laugh ]</p>
                  <blockquote className="ruled mt-1 pb-1 pr-4" style={{ lineHeight: "28px" }}>
                    <span className="font-display text-[19px] text-ink" style={{ fontWeight: 550 }}>
                      <span aria-hidden className="text-clay">“</span>
                      {company.bestLine.text}
                      <span aria-hidden className="text-clay">”</span>
                    </span>
                  </blockquote>
                  <figcaption className="tag tnum mt-2 text-[12px] text-ink-soft">
                    — {company.bestLine.speaker}, {clock(company.bestLine.t)}, {company.bestLine.momentTitle.toLowerCase()}
                  </figcaption>
                </figure>
              )}
            </Section>

            {/* ── 06 · moods & music ──────────────────────────────────────── */}
            <Section n="06" title="the weather of the day" i={4}>
              <ul className="space-y-2.5">
                {mood.moods.map((m, i) => (
                  <li key={m.momentId} className="grid grid-cols-[44px_110px_1fr] items-baseline gap-3">
                    <span className="fnote text-[10px] text-ink-faint">{clock(m.t)}</span>
                    <span className="tag min-w-0 truncate text-[12.5px] font-semibold text-ink">{m.mood}</span>
                    <span className="relative top-[-2px] block h-[5px] rounded-[3px] bg-ink/10">
                      <span
                        className="absolute inset-y-0 left-0 rounded-[3px]"
                        style={{ width: `${Math.round(m.energy * 100)}%`, background: inkForMoment(i).deep }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="fnote mt-3 text-[9px] text-ink-faint">
                [ energy, 0–1 · the day averaged {mood.avgEnergy.toFixed(2)} ]
              </p>

              <p className="tag mt-4 text-[12.5px] leading-relaxed text-ink-soft">
                {mood.tags.map((t, i) => (
                  <span key={t.tag}>
                    {i > 0 && <span className="text-ink-faint"> · </span>}
                    <span className="whitespace-nowrap">
                      {t.tag}
                      {t.count > 1 && <span className="tnum text-ink-faint"> ×{t.count}</span>}
                    </span>
                  </span>
                ))}
              </p>

              {mood.music.length > 0 && (
                <>
                  <p className="fnote mt-6 text-[9px] text-ink-faint">[ the day&apos;s soundtrack ]</p>
                  <ul className="mt-2 space-y-3">
                    {mood.music.map((tune) => (
                      <li key={`${tune.trackName}-${tune.momentTitle}`}>
                        <p className="tag text-[12.5px]">
                          <strong className="font-semibold text-ink">{tune.trackName}</strong>
                          <span className="text-ink-soft"> — {tune.artist}</span>
                        </p>
                        <p className="tag text-[12px] italic text-ink-faint">“{tune.chosenBecause}”</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>
          </div>

          {/* ── 07 · the log ──────────────────────────────────────────────── */}
          <Section n="07" title="the log — one line per kept moment" i={5}>
            <div className="divide-y divide-ink/8">
              {log.map((row, i) => (
                <LogRow key={row.id} row={row} index={i} clock={clock} onOpen={() => onOpenMoment(row.id)} />
              ))}
            </div>
          </Section>

          <p className="fnote mt-12 text-center text-[9px] text-ink-faint">
            [ compiled from {compactNumber(trip.stats.detectionCount)} detections · {trip.stats.candidateCount} flagged
            windows · the pipeline&apos;s own arithmetic — nothing here was written by hand ]
          </p>
        </div>
      </div>

      {/* Tooth over the page, soft shade at the edges — the journal's seat. */}
      <div className="papergrain pointer-events-none absolute inset-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 50%, rgb(27 27 24 / 0) 68%, rgb(27 27 24 / 0.1) 100%)",
        }}
      />
    </div>
  );
}

/* ── The page furniture ────────────────────────────────────────────────────── */

function Section({ n, title, i, children }: { n: string; title: string; i: number; children: React.ReactNode }) {
  return (
    <section className="rise-in mt-10" style={{ "--i": i } as React.CSSProperties}>
      <div className="mb-4 flex items-center gap-3">
        <p className="fnote shrink-0 text-[9.5px] text-ink-soft">
          [ {n} · {title} ]
        </p>
        <span aria-hidden className="h-px min-w-0 flex-1 bg-ink/15" />
      </div>
      {children}
    </section>
  );
}

function Figure({ value, label, detail }: { value: string; label: string; detail?: string }) {
  return (
    <div>
      <p className="font-display tnum text-[30px] leading-none text-ink" style={{ fontWeight: 580 }}>
        {value}
      </p>
      <p className="fnote mt-1.5 text-[9.5px] text-ink-soft">{label}</p>
      {detail && <p className="tag tnum mt-1 text-[11px] leading-snug text-ink-faint">{detail}</p>}
    </div>
  );
}

/* ── 02 · the ridge — detections over the day, moments planted on it ───────── */

function DayRidge({
  trip,
  ledger,
  onOpenMoment,
}: {
  trip: TripView;
  ledger: WalkLedger;
  onOpenMoment: (id: string) => void;
}) {
  const [readout, setReadout] = useState<{ t: number; count: number } | null>(null);
  const [hot, setHot] = useState<string | null>(null);

  const bins = trip.detectionBins;
  const maxCount = useMemo(() => Math.max(1, ...bins.map((b) => b.count)), [bins]);

  // The ridge as an area path in a normalized 0..1000 × 0..100 box. Strokes keep
  // their width via non-scaling-stroke; everything with text is HTML on top.
  const { areaD, lineD } = useMemo(() => {
    const pts = bins.map((b, i) => {
      const x = (i / (bins.length - 1)) * 1000;
      const y = 100 - (b.count / maxCount) * 92;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return {
      lineD: `M${pts.join(" L")}`,
      areaD: `M0,100 L${pts.join(" L")} L1000,100 Z`,
    };
  }, [bins, maxCount]);

  // Hour ticks along the baseline, each flying its wall clock.
  const ticks = useMemo(() => {
    const out: { pct: number; label: string }[] = [];
    for (let s = 3600; s < trip.durationSec; s += 3600) {
      out.push({ pct: (s / trip.durationSec) * 100, label: clockShort(trip.startedAt, s) });
    }
    return out;
  }, [trip.durationSec, trip.startedAt]);

  const binAt = (frac: number) => bins[Math.min(bins.length - 1, Math.max(0, Math.floor(frac * bins.length)))];

  return (
    <div>
      <div
        className="relative h-[130px]"
        role="img"
        aria-label={`Detections over the day, peaking at ${maxCount} per bin. Each flag is a kept moment; the log below lists them.`}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const frac = (e.clientX - r.left) / r.width;
          const bin = binAt(frac);
          setReadout({ t: frac * trip.durationSec, count: bin?.count ?? 0 });
        }}
        onPointerLeave={() => setReadout(null)}
      >
        {/* The ridge itself — the cameras' attention, in spruce ink. */}
        {/* h-[112px] explicitly: an abs-positioned SVG stretched top-to-bottom
            falls back to its viewBox ratio for height, which squashes the
            ridge on narrow screens. 112 = the container's 130 minus the rail. */}
        <svg className="absolute inset-x-0 bottom-[18px] h-[112px] w-full" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
          <path d={areaD} fill="var(--color-spruce)" opacity={0.12} />
          <path d={lineD} fill="none" stroke="var(--color-spruce)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>

        {/* Baseline and hour ticks. */}
        <span aria-hidden className="absolute inset-x-0 bottom-[18px] h-px bg-ink/30" />
        {ticks.map(({ pct, label }) => (
          <span key={label} aria-hidden className="absolute bottom-0" style={{ left: `${pct}%` }}>
            <span className="absolute bottom-[11px] h-[7px] w-px bg-ink/30" />
            <span className="fnote absolute bottom-0 -translate-x-1/2 text-[8.5px] text-ink-faint">{label}</span>
          </span>
        ))}

        {/* Laughs — clay nibs above the ridge, at the second they happened. */}
        {ledger.company.laughT.map((t, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute top-[2px] h-[5px] w-[5px] -translate-x-1/2 rounded-full bg-clay"
            title={`Laughter at ${clockShort(trip.startedAt, t)}`}
            style={{ left: `${(t / trip.durationSec) * 100}%` }}
          />
        ))}

        {/* The kept moments — the map's pennants, planted on the ridge. */}
        {trip.moments.map((m, i) => {
          const ink = inkForMoment(i);
          const on = hot === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onMouseEnter={() => setHot(m.id)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => setHot(m.id)}
              onBlur={() => setHot(null)}
              onClick={() => onOpenMoment(m.id)}
              aria-label={`Open moment: ${m.title}, ${clockShort(trip.startedAt, m.tStart)}`}
              className="absolute bottom-[18px] z-[2] block h-[26px] w-[14px] transition-transform duration-300 ease-(--ease-signature)"
              style={{
                left: `${(m.tStart / trip.durationSec) * 100}%`,
                transform: `translateX(-1px) scale(${on ? 1.25 : 1})`,
                transformOrigin: "bottom left",
              }}
            >
              <span aria-hidden className="absolute bottom-0 left-0 w-px" style={{ height: 24, background: ink.deep }} />
              <span
                aria-hidden
                className="absolute left-[1px] top-[1px] block"
                style={{ width: 11, height: 10, background: ink.deep, clipPath: "polygon(0 0, 100% 32%, 0 64%)" }}
              />
              {on && (
                <span
                  className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 flex w-max -translate-x-1/2 items-baseline gap-2 rounded-[4px] px-2.5 py-1.5"
                  style={{
                    background: "var(--color-vellum)",
                    boxShadow: "var(--ring-ink), 0 8px 20px rgb(27 27 24 / 0.2)",
                    animation: "takeover 0.3s var(--ease-signature) both",
                  }}
                >
                  <span className="fnote text-[9px]" style={{ color: ink.deep }}>
                    [ {clockShort(trip.startedAt, m.tStart)} ]
                  </span>
                  <span className="text-[11.5px] font-semibold text-ink">{m.title}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* The instrument's readout — follows the pointer along the ridge. */}
      <p className="fnote mt-2 h-[14px] text-[9px] text-ink-faint" aria-hidden>
        {readout
          ? `[ ${clockShort(trip.startedAt, readout.t)} · ${readout.count} detections in this stretch ]`
          : `[ the cameras' attention, ${clockShort(trip.startedAt, 0)} – ${clockShort(trip.startedAt, trip.durationSec)} · flags are kept moments · clay dots are laughs ]`}
      </p>
    </div>
  );
}

/* ── 03 · moving vs stopped — one bar, two inks, a paper seam between ──────── */

function SplitBar({ movingSec, pausedSec }: { movingSec: number; pausedSec: number }) {
  const total = Math.max(1, movingSec + pausedSec);
  const movingPct = (movingSec / total) * 100;
  return (
    <div>
      <div className="flex h-[10px] gap-[2px]">
        <span className="rounded-[3px] bg-brass" style={{ width: `${movingPct}%` }} />
        <span className="min-w-0 flex-1 rounded-[3px] bg-ink/15" />
      </div>
      <div className="tag tnum mt-2 flex justify-between text-[12px] text-ink-soft">
        <span>
          <strong className="font-semibold text-ink">{duration(movingSec)}</strong> on the move
        </span>
        <span>
          <strong className="font-semibold text-ink">{duration(pausedSec)}</strong> stood still
        </span>
      </div>
    </div>
  );
}

/* ── 04 · the cameras' attention by family — thin bars, one hue ────────────── */

function FamilyBars({ families }: { families: WalkLedger["perception"]["families"] }) {
  const max = Math.max(1, ...families.map((f) => f.detections));
  return (
    <ul className="mt-4 space-y-2">
      {families.map((f) => (
        <li key={f.family} className="grid grid-cols-[92px_1fr_84px] items-center gap-3">
          <span className="tag min-w-0 truncate text-[12px] text-ink">{f.family}</span>
          <span className="relative block h-[6px] rounded-[3px] bg-ink/8">
            <span
              className="absolute inset-y-0 left-0 rounded-[3px] bg-spruce"
              style={{ width: `${Math.max(1.5, (f.detections / max) * 100)}%` }}
            />
          </span>
          <span className="tag tnum text-right text-[11px] text-ink-faint">
            {compactNumber(f.detections)} · {f.labels} {f.labels === 1 ? "kind" : "kinds"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── 07 · a log line — the moment as one row of the day's accounting ───────── */

function LogRow({
  row,
  index,
  clock,
  onOpen,
}: {
  row: LedgerRow;
  index: number;
  clock: (t: number) => string;
  onOpen: () => void;
}) {
  const ink = inkForMoment(index);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-[66px_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 px-2 py-3 text-left transition-colors md:grid-cols-[66px_minmax(0,5fr)_minmax(0,4fr)]"
      style={{ background: "transparent" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = ink.wash)}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="h-[9px] w-[13px] shrink-0"
          style={{ background: ink.deep, clipPath: "polygon(0 0, 100% 0, calc(100% - 4px) 50%, 100% 100%, 0 100%)" }}
        />
        <span className="fnote text-[9.5px]" style={{ color: ink.deep }}>
          {clock(row.tStart)}
        </span>
      </span>

      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold leading-snug text-ink">
          {row.title}
          <span className="fnote ml-2 text-[8.5px] align-middle" style={{ color: splatInk(row.splatStatus) }}>
            {splatNote(row.splatStatus)}
          </span>
        </span>
        <span className="tag block truncate text-[11.5px] text-ink-faint">
          {row.placeLabel}
          {row.people.length > 0 && <> · with {listOut(row.people)}</>} · felt {row.mood}
        </span>
      </span>

      <span className="col-start-2 min-w-0 md:col-start-3 md:text-right">
        <span className="fnote block text-[9px] leading-snug text-ink-soft">
          kept for: {row.triggers.map((t) => TRIGGER_PHRASE[t]).join(" · ")}
        </span>
        <span className="tag tnum block text-[11px] text-ink-faint">
          {duration(row.tEnd - row.tStart)} · {row.wordCount} words · {row.laughCount}{" "}
          {row.laughCount === 1 ? "laugh" : "laughs"} · {row.objectCount} things
        </span>
      </span>
    </button>
  );
}

const splatNote = (s: LedgerRow["splatStatus"]) =>
  s === "ready" ? "[ in 3d ]" : s === "processing" ? "[ rebuilding ]" : "[ no capture ]";

const splatInk = (s: LedgerRow["splatStatus"]) =>
  s === "ready" ? "var(--color-moss)" : s === "processing" ? "var(--color-clay)" : "var(--color-ink-faint)";

/** "Jess" · "Jess & Ravi" · "Jess, Ravi & the whippet's owner" */
function listOut(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
