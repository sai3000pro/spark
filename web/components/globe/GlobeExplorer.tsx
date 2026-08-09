"use client";

/**
 * The globe screen: a rail of albums beside the planet, plus the HUD.
 *
 * Owns hoveredKey / selectedKey and nothing else, mirroring TripExplorer exactly
 * — which is what makes the rail and the pins highlight together.
 *
 * ACCESSIBILITY: the rail IS the keyboard interface. A WebGL canvas is not
 * keyboard-navigable and pretending otherwise with fake focus targets is worse
 * than not trying, so the pins carry no ARIA at all — they are a second rendering
 * of the list, not independent controls. The canvas gets one summary label.
 */
import Link from "next/link";
import { useRef, useState } from "react";
import { GlobeStage } from "@/components/globe/GlobeStage";
import { GlobeFlat } from "@/components/globe/GlobeFlat";
import { Keyframe } from "@/components/Keyframe";
import { distance, duration, shortDate } from "@/lib/format";
import { formatGeo } from "@/lib/globe/geo";
import type { GlobeView } from "@/lib/globeData";
import { useReducedMotion } from "@/lib/useReducedMotion";

export function GlobeExplorer({ view }: { view: GlobeView }) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

  const reducedMotion = useReducedMotion();
  const webgl = useWebGLSupport();

  const selected = view.pins.find((p) => p.key === selectedKey) ?? null;
  const toggleSelect = (key: string) => setSelectedKey((prev) => (prev === key ? null : key));

  // Roving focus: ↑/↓ move between albums in the rail, which flies the globe.
  const onRailKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const buttons = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>("button[data-pin]") ?? [],
    );
    const at = buttons.findIndex((b) => b === document.activeElement);
    buttons[Math.min(buttons.length - 1, Math.max(0, at + dir))]?.focus();
  };

  return (
    <div className="flex flex-col gap-4 md:h-[min(660px,max(460px,calc(100dvh-13rem)))] md:flex-row">
      {/* ── Rail ─────────────────────────────────────────────────────────── */}
      <div className="surface flex shrink-0 flex-col gap-3 rounded-2xl p-3 md:w-80 md:overflow-hidden">
        <p className="eyebrow shrink-0">
          {view.albums.length} albums · {view.pins.length} places
        </p>

        <div
          ref={railRef}
          onKeyDown={onRailKeyDown}
          className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5"
        >
          {view.pins.map((pin) =>
            pin.albums.map((album, i) => {
              const on = hoveredKey === pin.key || selectedKey === pin.key;
              return (
                <button
                  key={album.id}
                  type="button"
                  data-pin={pin.key}
                  aria-pressed={selectedKey === pin.key}
                  onMouseEnter={() => setHoveredKey(pin.key)}
                  onMouseLeave={() => setHoveredKey(null)}
                  onFocus={() => setHoveredKey(pin.key)}
                  onBlur={() => setHoveredKey(null)}
                  onClick={() => toggleSelect(pin.key)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-machine-400/60 ${
                    on
                      ? "border-memory-400/20 bg-memory-400/[0.08]"
                      : "border-white/[0.05] bg-white/[0.02] hover:border-white/10"
                  }`}
                >
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-ink-850">
                    {album.cover && (
                      <Keyframe
                        keyframe={{
                          placeholderSeed: album.cover.seed,
                          hue: album.cover.hue,
                          url: album.cover.url,
                        }}
                        alt=""
                        className="h-full w-full object-cover"
                        width={80}
                        height={80}
                      />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[13px] font-medium text-fog-100">
                      {album.title}
                    </span>
                    <span className="tnum block truncate font-mono text-[11px] text-fog-400">
                      {album.placeLabel}, {album.country} · {shortDate(album.startedAt)}
                    </span>
                  </span>

                  {pin.albums.length > 1 && i === 0 && (
                    <span className="shrink-0 rounded-full border border-memory-400/30 px-1.5 py-0.5 font-mono text-[10px] text-memory-300">
                      {pin.albums.length}
                    </span>
                  )}
                </button>
              );
            }),
          )}
        </div>
      </div>

      {/* ── Globe ────────────────────────────────────────────────────────── */}
      <div
        className="relative min-w-0 flex-1 overflow-hidden rounded-2xl bg-ink-950"
        // Definite height from the first layout pass — R3F will not initialise
        // its root until it measures a non-zero size.
        style={{ minHeight: 380 }}
        role="img"
        aria-label={`Globe with ${view.albums.length} albums pinned across ${view.pins.length} places`}
      >
        <div className="h-[380px] w-full sm:h-[460px] md:h-full">
          {webgl ? (
            <GlobeStage
              pins={view.pins}
              hoveredKey={hoveredKey}
              selectedKey={selectedKey}
              reducedMotion={reducedMotion}
              onHover={setHoveredKey}
              onSelect={toggleSelect}
              readoutRef={readoutRef}
            />
          ) : (
            <GlobeFlat
              pins={view.pins}
              hoveredKey={hoveredKey}
              selectedKey={selectedKey}
              onHover={setHoveredKey}
              onSelect={toggleSelect}
            />
          )}
        </div>

        {/* HUD — mirrors TripMap's legend / scale-bar idiom. */}
        {webgl && (
          <>
            <span
              className="glass pointer-events-none absolute left-3 top-3 rounded-full px-2 py-0.5 font-mono text-[10px] text-fog-400"
              title="Coastlines rasterized from Natural Earth 1:110m, public domain."
            >
              Natural Earth 110m · 512×256 land mask
            </span>

            <div className="glass pointer-events-none absolute right-3 top-3 space-y-1 rounded-xl px-3 py-2">
              <LegendRow color="var(--color-memory-400)" label="Album" />
              <LegendRow color="var(--color-machine-600)" label="Equator" hairline />
            </div>

            <span
              ref={readoutRef}
              className="tnum pointer-events-none absolute bottom-3 left-3 font-mono text-[10px] text-fog-400"
            />

            <p className="pointer-events-none absolute bottom-3 right-3 text-[10px] text-fog-400">
              Drag to orbit · scroll to zoom · click a pin to open an album
            </p>
          </>
        )}

        {/* Selected-pin card. Same placement as TripExplorer's moment panel. */}
        {selected && (
          <div className="glass absolute inset-x-0 bottom-0 rounded-t-2xl p-3 md:inset-x-auto md:bottom-auto md:right-4 md:top-14 md:w-80 md:rounded-2xl">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="eyebrow">
                {selected.albums.length === 1
                  ? selected.albums[0].country
                  : `${selected.albums.length} albums here`}
              </p>
              <button
                type="button"
                onClick={() => setSelectedKey(null)}
                aria-label="Close"
                className="shrink-0 font-mono text-[11px] text-fog-400 transition-colors hover:text-fog-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2">
              {selected.albums.map((album) => (
                <Link
                  key={album.id}
                  href={`/trip/${album.id}`}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2 transition-colors hover:border-memory-400/30"
                >
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-ink-850">
                    {album.cover && (
                      <Keyframe
                        keyframe={{
                          placeholderSeed: album.cover.seed,
                          hue: album.cover.hue,
                          url: album.cover.url,
                        }}
                        alt=""
                        className="h-full w-full object-cover"
                        width={96}
                        height={96}
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-[13px] font-semibold text-fog-100">
                      {album.title}
                    </span>
                    <span className="tnum block truncate font-mono text-[10px] text-fog-400">
                      {album.momentCount} moments · {duration(album.durationSec)} ·{" "}
                      {distance(album.distanceM)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-memory-300">→</span>
                </Link>
              ))}
            </div>

            <p className="tnum mt-2 font-mono text-[10px] text-fog-400">
              {formatGeo(selected.origin)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  hairline,
}: {
  color: string;
  label: string;
  hairline?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={hairline ? "h-[2px] w-3 rounded-full" : "h-2 w-2 rounded-full"}
        style={{ background: color }}
      />
      <span className="font-mono text-[10px] text-fog-400">{label}</span>
    </div>
  );
}

/**
 * Probe once, in the spirit of SplatStage's HEAD probe: do not let the renderer
 * fail, ask first.
 *
 * A lazy useState initializer rather than an effect — it runs during the first
 * render and costs no second pass, which is the same derive-don't-sync rule
 * MomentDetail's header sets out. Safe to touch `document` here only because the
 * whole tree is loaded with ssr:false and never renders on the server.
 */
function useWebGLSupport(): boolean {
  const [supported] = useState(() => {
    try {
      const canvas = document.createElement("canvas");
      return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      return false;
    }
  });

  return supported;
}
