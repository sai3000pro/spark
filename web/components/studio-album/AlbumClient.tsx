"use client";

/**
 * The album grid and its editors.
 *
 * Each card is a print: cover frame, title, location. It stays quiet until you
 * hover — then two ways in surface, exactly the two the studio's own cards offer:
 * "Enter splat" opens bigview (the true gaussian renderer, on the studio origin
 * where SharedArrayBuffer is granted) and "Frames" opens the source-frame album.
 * Two hover controls edit the card: the pencil re-picks the cover, the ⋯ opens
 * the details editor (rename + location).
 *
 * A run's location is what the /walk map plots, so setting it here is how the map
 * gets real data. All edits POST to the studio (via our proxies) and update the
 * card in place; everything else is a plain link and works before hydration.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDuration, studioFileUrl } from "@/lib/studio";

export interface AlbumPlace {
  name: string;
  lat: number | null;
  lng: number | null;
}

export interface AlbumItem {
  id: string;
  title: string;
  place: AlbumPlace | null;
  gaussians: number | null;
  cover: string | null;
  /** bigview link — null while training (no finished ply yet) or if the run has no ply. */
  splatUrl: string | null;
  framesUrl: string;
  /** Still reconstructing — show a "Training…" badge, no "Enter splat" yet. */
  training?: boolean;
  /** Short reconstruction specs, e.g. ["891 frames", "30k steps", "1600px"]. */
  specs?: string[];
  /** Seed for the live training readout (progress + ETA), polled while running. */
  train?: { started: number | null; latestIter: number | null; steps: number | null };
}

/** 1,241,766 → "1.2M", 93,968 → "94k" — the specimen-tag scale. */
function splatCount(n: number | null): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

export function AlbumClient({ items }: { items: AlbumItem[] }) {
  // Local layers over the server's initial data, so edits show without a reload.
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<
    Record<string, { title: string; place: AlbumPlace | null }>
  >({});
  const [picking, setPicking] = useState<AlbumItem | null>(null);
  const [editing, setEditing] = useState<AlbumItem | null>(null);

  const onPicked = useCallback((id: string, path: string) => {
    // Cache-bust so the <img> reloads even though the /file path is unchanged.
    setCovers((c) => ({ ...c, [id]: `${studioFileUrl(path)}&t=${Date.now()}` }));
    setPicking(null);
  }, []);

  const onSaved = useCallback((id: string, title: string, place: AlbumPlace | null) => {
    setDetails((d) => ({ ...d, [id]: { title, place } }));
    setEditing(null);
  }, []);

  if (items.length === 0) {
    return (
      <p className="fnote max-w-md text-ink-faint">
        No moments yet. Finish a run in the studio and it lands here.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const d = details[item.id];
          const merged: AlbumItem = d ? { ...item, title: d.title, place: d.place } : item;
          return (
            <AlbumCard
              key={item.id}
              item={merged}
              cover={covers[item.id] ?? item.cover}
              onEditCover={() => setPicking(item)}
              onEditDetails={() => setEditing(merged)}
            />
          );
        })}
      </div>

      {picking && (
        <CoverPicker
          item={picking}
          onClose={() => setPicking(null)}
          onPicked={(path) => onPicked(picking.id, path)}
        />
      )}

      {editing && (
        <DetailsEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(title, place) => onSaved(editing.id, title, place)}
        />
      )}
    </>
  );
}

function AlbumCard({
  item,
  cover,
  onEditCover,
  onEditDetails,
}: {
  item: AlbumItem;
  cover: string | null;
  onEditCover: () => void;
  onEditDetails: () => void;
}) {
  const count = splatCount(item.gaussians);
  const located = item.place?.lat != null && item.place?.lng != null;

  return (
    <figure className="ink-halo group relative overflow-hidden rounded-md bg-vellum">
      <div className="relative aspect-[4/3] overflow-hidden bg-milk">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- cross-origin studio file, not a Next asset
          <img
            src={cover}
            alt={item.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="fnote text-ink-faint">[ no cover ]</span>
          </div>
        )}

        {/* Training badge — a run still reconstructing has no splat to enter yet. */}
        {item.training && (
          <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5 rounded-full bg-pine/85 px-2.5 py-1 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brass" aria-hidden />
            <span className="fnote text-milk">Training…</span>
          </div>
        )}

        {/* Hover veil + the two ways in. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-pine/85 via-pine/25 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <div className="pointer-events-auto flex gap-2 p-3">
            {item.splatUrl ? (
              <a
                href={item.splatUrl}
                target="_blank"
                rel="noreferrer"
                className="pill-brass px-3.5 py-1.5 text-[12.5px]"
              >
                {item.training ? "Watch live" : "Enter splat"}
              </a>
            ) : item.training ? (
              <span className="pill-ghost px-3.5 py-1.5 text-[12.5px] text-milk/80">
                Building splat…
              </span>
            ) : null}
            <a
              href={item.framesUrl}
              target="_blank"
              rel="noreferrer"
              className="pill-ghost px-3.5 py-1.5 text-[12.5px] text-milk"
            >
              Frames
            </a>
          </div>
        </div>

        {/* Edit controls, above the veil so they work while hovering. */}
        <div className="absolute right-2.5 top-2.5 z-10 flex gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <IconButton title="Edit details" onClick={onEditDetails}>
            {/* three dots */}
            <circle cx="4" cy="8" r="1.3" fill="currentColor" />
            <circle cx="8" cy="8" r="1.3" fill="currentColor" />
            <circle cx="12" cy="8" r="1.3" fill="currentColor" />
          </IconButton>
          <IconButton title="Change cover" onClick={onEditCover}>
            <path
              d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
              fill="none"
            />
          </IconButton>
        </div>
      </div>

      <figcaption className="px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[15px] font-semibold text-ink" title={item.title}>
              {item.title}
            </h2>
            <p className="fnote mt-0.5 flex items-center gap-1.5 truncate text-ink-faint">
              {located && <span className="text-brass-deep" aria-hidden>◈</span>}
              {item.place?.name ?? "— unplaced —"}
            </p>
          </div>
          {count && (
            <span className="fnote shrink-0 text-brass-deep" title="Gaussian splats">
              [ {count} ]
            </span>
          )}
        </div>
        {item.training ? (
          <TrainingStatus item={item} />
        ) : (
          item.specs &&
          item.specs.length > 0 && (
            <p className="fnote mt-1.5 truncate text-ink-faint" title={item.specs.join(" · ")}>
              {item.specs.join(" · ")}
            </p>
          )
        )}
      </figcaption>
    </figure>
  );
}

/**
 * Live training readout — a progress bar, percent, and a self-correcting ETA.
 * Seeds from the server-rendered snapshot, then polls the studio (via our proxy)
 * every 8s and estimates time-left from the iteration rate between polls, so the
 * estimate sharpens instead of trusting the run's start time (which includes
 * export). When the run finishes it stops and invites a refresh.
 */
function TrainingStatus({ item }: { item: AlbumItem }) {
  const steps = item.train?.steps ?? null;
  const [iter, setIter] = useState<number | null>(item.train?.latestIter ?? null);
  const [etaSecs, setEtaSecs] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const sample = useRef<{ t: number; iter: number } | null>(null);
  /** Whether the rough opening estimate has been laid down — see `poll`. */
  const seeded = useRef(false);

  useEffect(() => {
    if (done) return;
    let live = true;

    async function poll() {
      /*
        Client-only seed (avoids an SSR/client time mismatch): a rough ETA from
        elapsed, so something is on screen before the first reading lands.

        It used to sit in the effect body, which cost twice. A setState run
        synchronously by an effect cascades an extra render — what the lint rule
        is for — and this one ALSO fed back through the dependency list below,
        so every sharpened estimate tore down the interval and rebuilt it, then
        polled again immediately. An 8-second poll was not running every eight
        seconds. Seeding from inside `poll` and remembering it in a ref keeps the
        estimate and leaves the timer alone.
      */
      if (!seeded.current) {
        seeded.current = true;
        // The two fields, not the object they sit on: these are exactly what the
        // dependency list below names, and reaching for `item.train` whole would
        // make the effect depend on an identity that changes on every poll.
        const started = item.train?.started;
        const latestIter = item.train?.latestIter;
        if (started && latestIter && latestIter > 0 && steps) {
          const elapsed = Date.now() / 1000 - started;
          setEtaSecs(elapsed * (steps / latestIter - 1));
        }
      }

      try {
        const res = await fetch("/api/album/runs", { cache: "no-store" });
        const data = (await res.json()) as { runs?: Array<Record<string, unknown>> };
        const r = (data.runs ?? []).find((x) => x.id === item.id);
        if (!live || !r) return;
        if (r.status === "done" && r.result_ply) {
          setDone(true);
          return;
        }
        const li = typeof r.latest_iter === "number" ? r.latest_iter : null;
        if (li != null) {
          setIter(li);
          const now = Date.now() / 1000;
          const prev = sample.current;
          if (prev && li > prev.iter && steps) {
            const rate = (li - prev.iter) / Math.max(1, now - prev.t); // iters/sec
            if (rate > 0) setEtaSecs((steps - li) / rate);
          }
          sample.current = { t: now, iter: li };
        }
      } catch {
        /* studio momentarily unreachable — keep the last reading */
      }
    }
    poll();
    const id = setInterval(poll, 8000);
    return () => {
      live = false;
      clearInterval(id);
    };
    // `etaSecs` is deliberately NOT a dependency: the effect no longer reads it
    // (the seed guard is a ref), and listing it is what made the estimate
    // restart its own poll loop.
  }, [item.id, item.train?.started, item.train?.latestIter, steps, done]);

  if (done) {
    return <p className="fnote mt-1.5 truncate text-brass-deep">✓ Ready — refresh to enter</p>;
  }

  const pct = steps && iter ? Math.min(99, Math.round((iter / steps) * 100)) : null;
  const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
  const bits: string[] = [];
  if (etaSecs != null) bits.push(`≈ ${formatDuration(etaSecs)} left`);
  if (steps && iter) bits.push(`${k(iter)} / ${k(steps)} steps`);
  const text = bits.length ? bits.join(" · ") : "starting…";

  return (
    <div className="mt-1.5">
      {pct != null && (
        <div className="mb-1 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-brass transition-[width] duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="fnote shrink-0 text-brass-deep">{pct}%</span>
        </div>
      )}
      <p className="fnote truncate text-ink-faint" title={text}>
        {text}
      </p>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="grid h-8 w-8 place-items-center rounded-full bg-vellum/85 text-ink shadow-sm backdrop-blur-sm transition hover:bg-vellum"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** The frame picker — a modal grid of every source frame; click one to pin it. */
function CoverPicker({
  item,
  onClose,
  onPicked,
}: {
  item: AlbumItem;
  onClose: () => void;
  onPicked: (path: string) => void;
}) {
  const [frames, setFrames] = useState<string[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/album/frames?run=${encodeURIComponent(item.id)}`)
      .then((r) => r.json())
      .then((d: { frames?: string[] }) => live && setFrames(d.frames ?? []))
      .catch(() => live && setError("Couldn't load frames."));
    return () => {
      live = false;
    };
  }, [item.id]);

  async function pick(path: string) {
    setSaving(path);
    setError(null);
    try {
      const res = await fetch("/api/album/thumb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, path }),
      });
      if (!res.ok) throw new Error();
      onPicked(path);
    } catch {
      setError("Couldn't save the cover.");
      setSaving(null);
    }
  }

  return (
    <Modal onClose={onClose} label={`Choose a cover for ${item.title}`} eyebrow="choose cover" title={item.title}>
      {error && <p className="fnote mb-3 text-clay">{error}</p>}
      {frames === null && !error && <p className="fnote text-ink-faint">loading frames…</p>}
      {frames && frames.length === 0 && (
        <p className="fnote text-ink-faint">No source frames for this run.</p>
      )}
      {frames && frames.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {frames.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => pick(path)}
              disabled={saving !== null}
              className={`relative overflow-hidden rounded-sm border border-ink/10 transition ${
                saving === path
                  ? "opacity-60"
                  : "hover:border-brass hover:ring-2 hover:ring-brass/40 disabled:opacity-40"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- cross-origin studio file */}
              <img
                src={studioFileUrl(path)}
                alt=""
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface GeoResult {
  name: string;
  lat: number | null;
  lng: number | null;
}

/** Rename + set a location. Location can be geocoded from a name or typed raw. */
function DetailsEditor({
  item,
  onClose,
  onSaved,
}: {
  item: AlbumItem;
  onClose: () => void;
  onSaved: (title: string, place: AlbumPlace | null) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [placeName, setPlaceName] = useState(item.place?.name ?? "");
  const [lat, setLat] = useState(item.place?.lat != null ? String(item.place.lat) : "");
  const [lng, setLng] = useState(item.place?.lng != null ? String(item.place.lng) : "");
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function geocode() {
    if (!placeName.trim()) return;
    setSearching(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/album/geocode?q=${encodeURIComponent(placeName.trim())}`);
      const d = (await res.json()) as { results?: GeoResult[] };
      setResults(d.results ?? []);
    } catch {
      setError("Geocoder unreachable — enter lat/lng by hand.");
    } finally {
      setSearching(false);
    }
  }

  function chooseResult(r: GeoResult) {
    setPlaceName(r.name);
    setLat(r.lat != null ? String(r.lat) : "");
    setLng(r.lng != null ? String(r.lng) : "");
    setResults(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const nLat = lat.trim() === "" ? null : Number(lat);
    const nLng = lng.trim() === "" ? null : Number(lng);
    if ((nLat !== null && Number.isNaN(nLat)) || (nLng !== null && Number.isNaN(nLng))) {
      setError("Latitude and longitude must be numbers.");
      setSaving(false);
      return;
    }
    // Run each edit, remembering which one it was so a failure names itself.
    const jobs: { what: string; body: unknown; url: string }[] = [];
    if (title.trim() && title.trim() !== item.title) {
      jobs.push({ what: "rename", url: "/api/album/rename", body: { id: item.id, label: title.trim() } });
    }
    jobs.push({
      what: "location",
      url: "/api/album/place",
      body: { id: item.id, name: placeName.trim(), lat: nLat, lng: nLng },
    });

    try {
      for (const job of jobs) {
        let res: Response;
        try {
          res = await fetch(job.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(job.body),
          });
        } catch {
          // Network-level failure — the dev server or the route isn't reachable.
          throw new Error(`Can't reach the app server saving ${job.what}. Reload the page?`);
        }
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}));
          const msg = (detail as { error?: string }).error;
          throw new Error(
            `Saving ${job.what} failed (${res.status}${msg ? `: ${msg}` : ""}).` +
              (res.status === 502 ? " Is the studio (:8899) running?" : ""),
          );
        }
      }
      const place: AlbumPlace | null = placeName.trim() || nLat !== null
        ? { name: placeName.trim(), lat: nLat, lng: nLng }
        : null;
      onSaved(title.trim() || item.title, place);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
      setSaving(false);
    }
  }

  async function clearLocation() {
    setPlaceName("");
    setLat("");
    setLng("");
    setResults(null);
  }

  return (
    <Modal onClose={onClose} label={`Edit ${item.title}`} eyebrow="edit moment" title={item.title}>
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-ink/15 bg-vellum px-3 py-2 text-[14px] text-ink outline-none focus:border-brass"
          />
        </Field>

        <Field label="Location">
          <div className="flex gap-2">
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="e.g. Waterloo Park, Ontario"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  geocode();
                }
              }}
              className="w-full rounded-md border border-ink/15 bg-vellum px-3 py-2 text-[14px] text-ink outline-none focus:border-brass"
            />
            <button
              type="button"
              onClick={geocode}
              disabled={searching || !placeName.trim()}
              className="pill-ghost shrink-0 px-3.5 py-2 text-[12.5px] text-ink disabled:opacity-40"
            >
              {searching ? "…" : "Find on map"}
            </button>
          </div>
          {results && results.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border border-ink/10">
              {results.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => chooseResult(r)}
                    className="block w-full truncate px-3 py-1.5 text-left text-[12.5px] text-ink-soft transition hover:bg-milk"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results && results.length === 0 && (
            <p className="fnote mt-2 text-ink-faint">No matches — enter lat/lng by hand.</p>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <input
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              inputMode="decimal"
              placeholder="43.4643"
              className="w-full rounded-md border border-ink/15 bg-vellum px-3 py-2 text-[14px] text-ink outline-none focus:border-brass"
            />
          </Field>
          <Field label="Longitude">
            <input
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              inputMode="decimal"
              placeholder="-80.5204"
              className="w-full rounded-md border border-ink/15 bg-vellum px-3 py-2 text-[14px] text-ink outline-none focus:border-brass"
            />
          </Field>
        </div>
        <p className="fnote -mt-1 text-ink-faint">
          A location with coordinates gets a pin on the map.
        </p>

        {error && <p className="fnote text-clay">{error}</p>}

        <div className="mt-1 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={clearLocation}
            className="fnote text-ink-faint transition-colors hover:text-clay"
          >
            clear location
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="pill-ghost px-4 py-2 text-[13px] text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="pill-brass px-4 py-2 text-[13px] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="fnote mb-1.5 block text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

/** Shared modal chrome for the cover picker and the details editor. */
function Modal({
  onClose,
  label,
  eyebrow,
  title,
  children,
}: {
  onClose: () => void;
  label: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-pine/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-paper shadow-2xl">
        <div className="flex items-baseline justify-between gap-4 border-b border-ink/10 px-5 py-3.5">
          <div className="min-w-0">
            <p className="fnote text-ink-faint">[ {eyebrow} ]</p>
            <h3 className="truncate font-display text-base font-semibold text-ink">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="fnote text-ink-faint transition-colors hover:text-ink"
            aria-label="Close"
          >
            close ✕
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
