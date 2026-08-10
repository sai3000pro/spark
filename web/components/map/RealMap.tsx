"use client";

/**
 * The map, on real data: every located splat pinned on the journal's cream
 * survey map. This replaces the old mock-trip walk — there is no path, no replay,
 * no robot here, because a splat only knows WHERE it is, not the journey between.
 * A run gets onto this map by being given coordinates in the album.
 *
 * Co-located moments STACK. Pins are clustered in screen space and recomputed on
 * every pan/zoom, so two splats shot in the same spot ride as one stacked marker
 * with a count and split apart as you zoom in. Tapping any marker opens a panel
 * of the moments under it — each with the same two ways in as the album (Enter
 * splat / Frames). Same MapLibre field-notes style as FieldMap, so the two maps
 * are one place.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { setWorkerUrl } from "maplibre-gl";
import MapGL, { Marker, ScaleControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

// Same worker shim FieldMap needs — without it the style never loads under
// Turbopack. Files copied to public/map-lib by scripts/copy-maplibre-worker.mjs.
if (typeof window !== "undefined") {
  setWorkerUrl("/map-lib/maplibre-gl-worker.mjs");
}
import { NavBrandSwitch } from "@/components/shell/NavBrandSwitch";
import { BRASS, PAPER, PINE } from "@/lib/theme";
import type { MapPin } from "@/lib/studio";

interface Cluster {
  key: string;
  lng: number;
  lat: number;
  items: MapPin[];
}

/** Greedy screen-space clustering: pins within `px` of each other merge. Runs on
 *  every view change, so clusters split as you zoom (identical coords never do —
 *  distance 0 — which is exactly the "same spot" stack we want). */
function clusterByScreen(map: MapRef, pins: MapPin[], px: number): Cluster[] {
  const pts = pins.map((p) => ({ p, xy: map.project([p.lng, p.lat]) }));
  const used = new Array(pts.length).fill(false);
  const out: Cluster[] = [];
  const r2 = px * px;
  for (let i = 0; i < pts.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const items = [pts[i].p];
    for (let j = i + 1; j < pts.length; j++) {
      if (used[j]) continue;
      const dx = pts[i].xy.x - pts[j].xy.x;
      const dy = pts[i].xy.y - pts[j].xy.y;
      if (dx * dx + dy * dy <= r2) {
        used[j] = true;
        items.push(pts[j].p);
      }
    }
    const lng = items.reduce((s, p) => s + p.lng, 0) / items.length;
    const lat = items.reduce((s, p) => s + p.lat, 0) / items.length;
    out.push({ key: items.map((p) => p.id).join("_"), lng, lat, items });
  }
  return out;
}

function pinBounds(pins: MapPin[]): [[number, number], [number, number]] {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of pins) {
    minLng = Math.min(minLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLng = Math.max(maxLng, p.lng);
    maxLat = Math.max(maxLat, p.lat);
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

export function RealMap({ pins }: { pins: MapPin[] }) {
  const mapRef = useRef<MapRef>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selected, setSelected] = useState<MapPin[] | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const initial = useMemo(() => {
    if (pins.length === 0) return { longitude: -80.52, latitude: 43.46, zoom: 3 };
    const [[w, s], [e, n]] = pinBounds(pins);
    return { longitude: (w + e) / 2, latitude: (s + n) / 2, zoom: pins.length === 1 ? 15 : 4 };
  }, [pins]);

  const recompute = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    setClusters(clusterByScreen(map, pins, 46));
  }, [pins]);

  const onLoad = useCallback(() => {
    const map = mapRef.current;
    if (map && pins.length > 1) {
      map.fitBounds(pinBounds(pins), { padding: 90, duration: 0, maxZoom: 16 });
    }
    recompute();
  }, [pins, recompute]);

  return (
    <div className="relative h-dvh min-h-[480px] w-full overflow-hidden bg-paper text-ink">
      <MapGL
        ref={mapRef}
        mapStyle="/map/field-notes.json"
        initialViewState={initial}
        onLoad={onLoad}
        onMoveEnd={recompute}
        onResize={recompute}
        minZoom={2}
        maxZoom={18.5}
        attributionControl={{ compact: true }}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        {clusters.map((c) =>
          c.items.length === 1 ? (
            <Marker key={c.key} longitude={c.lng} latitude={c.lat} anchor="bottom" style={{ zIndex: hovered === c.key ? 3 : 2 }}>
              <SinglePin
                title={c.items[0].placeName}
                active={hovered === c.key}
                onHover={(h) => setHovered(h ? c.key : null)}
                onOpen={() => setSelected(c.items)}
              />
            </Marker>
          ) : (
            <Marker key={c.key} longitude={c.lng} latitude={c.lat} anchor="bottom" style={{ zIndex: hovered === c.key ? 3 : 2 }}>
              <StackPin
                count={c.items.length}
                active={hovered === c.key}
                onHover={(h) => setHovered(h ? c.key : null)}
                onOpen={() => setSelected(c.items)}
              />
            </Marker>
          ),
        )}

        <ScaleControl position="bottom-left" maxWidth={110} unit="metric" />
      </MapGL>

      {/* Paper tooth + edge shade so the map sits IN the journal. */}
      <div className="papergrain pointer-events-none absolute inset-0" aria-hidden />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, rgb(250 244 227 / 0.75) 0%, rgb(250 244 227 / 0) 15%, rgb(250 244 227 / 0) 72%, rgb(250 244 227 / 0.8) 100%),
            radial-gradient(120% 90% at 50% 50%, rgb(27 27 24 / 0) 62%, rgb(27 27 24 / 0.12) 100%)`,
        }}
      />

      {/* ── Floating chrome — the same nav the rest of the app wears. ──────── */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="plate-vellum papergrain pointer-events-auto relative overflow-hidden px-4 py-3">
          <NavBrandSwitch tone="paper" />
          <p className="tag tnum mt-2.5 text-[12px] text-ink-soft">
            {pins.length} {pins.length === 1 ? "moment" : "moments"} on the map
          </p>
        </div>
      </header>

      {pins.length === 0 && <EmptyMap />}

      {selected && <MomentPanel pins={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Marks
// ─────────────────────────────────────────────────────────────────────────────

function SinglePin({
  title,
  active,
  onHover,
  onOpen,
}: {
  title: string;
  active: boolean;
  onHover: (h: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${title}. Open the moment.`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onOpen}
      className="relative block cursor-pointer"
      style={{ transform: active ? "scale(1.14)" : "scale(1)", transformOrigin: "bottom center", transition: "transform 0.3s var(--ease-signature)" }}
    >
      <span aria-hidden className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full" style={{ width: 15, height: 5, background: "rgb(27 27 24 / 0.3)", filter: "blur(1.6px)" }} />
      <span className="flex flex-col items-center">
        <span className="relative grid place-items-center rounded-full" style={{ width: 25, height: 25, background: BRASS, boxShadow: `0 0 0 2px rgb(255 251 240 / 0.95), 0 2px 5px rgb(27 27 24 / 0.28)` }}>
          {active && <span aria-hidden className="sonar absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 1.5px ${BRASS}` }} />}
          <span className="block rounded-full" style={{ width: 6, height: 6, background: PINE }} />
        </span>
        <span aria-hidden className="block" style={{ width: 1.5, height: 13, background: PINE, opacity: 0.9 }} />
      </span>
      {active && (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 flex w-max max-w-[220px] -translate-x-1/2 items-baseline gap-2 rounded-[6px] px-2.5 py-1.5"
          style={{ background: "var(--color-vellum)", boxShadow: "var(--ring-ink), 0 8px 24px rgb(27 27 24 / 0.22)", animation: "takeover 0.3s var(--ease-signature) both" }}
        >
          <span className="truncate text-[12px] font-semibold text-ink">{title}</span>
          <span className="fnote shrink-0 text-[8.5px] text-ink-faint">step inside</span>
        </span>
      )}
    </button>
  );
}

/** A stack of co-located moments — offset cards behind a numbered head. */
function StackPin({
  count,
  active,
  onHover,
  onOpen,
}: {
  count: number;
  active: boolean;
  onHover: (h: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${count} moments here. Open the stack.`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onOpen}
      className="relative block cursor-pointer"
      style={{ transform: active ? "scale(1.1)" : "scale(1)", transformOrigin: "bottom center", transition: "transform 0.3s var(--ease-signature)" }}
    >
      <span aria-hidden className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 rounded-full" style={{ width: 18, height: 5, background: "rgb(27 27 24 / 0.32)", filter: "blur(1.8px)" }} />
      <span className="flex flex-col items-center">
        <span className="relative" style={{ width: 32, height: 30 }}>
          {/* two offset paper cards behind, to read as a stack */}
          <span aria-hidden className="absolute rounded-[6px]" style={{ inset: "2px 6px 8px 0", background: "rgb(255 251 240 / 0.95)", boxShadow: `inset 0 0 0 1px ${PINE}22, 0 1px 2px rgb(27 27 24 / 0.2)`, transform: "rotate(-8deg)" }} />
          <span aria-hidden className="absolute rounded-[6px]" style={{ inset: "2px 0 8px 6px", background: "rgb(255 251 240 / 0.97)", boxShadow: `inset 0 0 0 1px ${PINE}22, 0 1px 2px rgb(27 27 24 / 0.2)`, transform: "rotate(7deg)" }} />
          {/* front head with count */}
          <span className="absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full" style={{ width: 26, height: 26, background: PINE, boxShadow: `0 0 0 2px rgb(255 251 240 / 0.95), 0 2px 6px rgb(27 27 24 / 0.3)` }}>
            {active && <span aria-hidden className="sonar absolute inset-0 rounded-full" style={{ boxShadow: `0 0 0 1.5px ${PINE}` }} />}
            <span className="fnote text-[10px] leading-none" style={{ color: PAPER }}>{count}</span>
          </span>
        </span>
        <span aria-hidden className="block" style={{ width: 1.5, height: 12, background: PINE, opacity: 0.9 }} />
      </span>
      {active && (
        <span
          className="pointer-events-none absolute bottom-[calc(100%+9px)] left-1/2 flex w-max -translate-x-1/2 items-baseline gap-2 rounded-[6px] px-2.5 py-1.5"
          style={{ background: "var(--color-vellum)", boxShadow: "var(--ring-ink), 0 8px 24px rgb(27 27 24 / 0.22)", animation: "takeover 0.3s var(--ease-signature) both" }}
        >
          <span className="fnote text-[9px] text-brass-deep">[ {count} ]</span>
          <span className="text-[12px] font-semibold text-ink">moments here</span>
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel — the moments under a tapped marker
// ─────────────────────────────────────────────────────────────────────────────

function MomentPanel({ pins, onClose }: { pins: MapPin[]; onClose: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 p-4 sm:p-5">
      <div className="plate-vellum papergrain pointer-events-auto relative mx-auto max-h-[54vh] w-full max-w-3xl overflow-hidden rounded-lg">
        <div className="flex items-baseline justify-between gap-4 border-b border-ink/10 px-4 py-2.5">
          <p className="fnote text-ink-soft">
            [ {pins.length} {pins.length === 1 ? "moment" : "moments"} here ]
          </p>
          <button type="button" onClick={onClose} className="fnote text-ink-faint transition-colors hover:text-ink" aria-label="Close">
            close ✕
          </button>
        </div>
        <ul className="max-h-[44vh] divide-y divide-ink/8 overflow-y-auto">
          {pins.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-sm bg-milk">
                {p.cover && (
                  // eslint-disable-next-line @next/next/no-img-element -- cross-origin studio file
                  <img src={p.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[14px] font-semibold text-ink" title={p.title}>{p.title}</p>
                <p className="fnote truncate text-ink-faint">{p.placeName}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {p.splatUrl && (
                  <a href={p.splatUrl} target="_blank" rel="noreferrer" className="pill-brass px-3 py-1.5 text-[12px]">
                    Enter splat
                  </a>
                )}
                <a href={p.framesUrl} target="_blank" rel="noreferrer" className="pill-ghost px-3 py-1.5 text-[12px] text-ink">
                  Frames
                </a>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EmptyMap() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
      <div className="plate-vellum papergrain pointer-events-auto max-w-sm rounded-lg px-6 py-5 text-center">
        <p className="fnote text-ink-faint">[ no pinned moments ]</p>
        <h2 className="mt-2 font-display text-lg font-semibold text-ink">The map is waiting</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
          Open a moment in the album, add a location, and it drops a pin here.
        </p>
        <a href="/album" className="pill-brass mt-4 inline-flex px-4 py-2 text-[13px]">
          Go to the album
        </a>
      </div>
    </div>
  );
}
