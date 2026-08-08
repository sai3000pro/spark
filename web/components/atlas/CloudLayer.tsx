"use client";

/**
 * Fair-weather clouds over the survey map.
 *
 * A handful of cumulus drift slowly across the park, anchored to the WORLD,
 * not the screen: each cloud owns a lng/lat, a size in metres and a heading,
 * and every frame it is re-projected through the live map transform. Panning
 * slides them with the ground, zooming scales them with the ground — which is
 * what sells the altitude trick:
 *
 *   zoomed out  → you are above the weather: soft white cumulus, faint shadows
 *   zoomed in   → you are under it: the cloud fades away and only its shadow
 *                 stays pressed on the ground
 *
 * Sprites are pre-rendered once to offscreen canvases (two passes of gaussian
 * puffs — a warm-grey shade pass under a milk body pass, cohered by a cheap
 * downsample blur). Shadows reuse the same silhouette, tinted ink, pre-blurred,
 * offset to the south-east and squashed by the camera pitch so they lie on the
 * ground plane. Everything renders into one pointer-transparent canvas — the
 * map underneath stays fully interactive.
 *
 * Reduced motion: the sky still exists, the wind just stops.
 */
import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";

/** Crossfade band: fully above the clouds at ≤ABOVE_Z, fully under at ≥UNDER_Z. */
const ABOVE_Z = 14.15;
const UNDER_Z = 15.55;

const CLOUD_COUNT = 16;
const WIND_HEADING = (117 * Math.PI) / 180; // a lazy south-easterly
const SHADOW_OFFSET_M: [number, number] = [110, 150]; // sun out of the north-west

interface Cloud {
  lng: number;
  lat: number;
  sizeM: number;
  speed: number; // m/s
  heading: number;
  sprite: number;
  wobble: number; // phase for the very slow vertical breathe
}

const mulberry32 = (a: number) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One cumulus: puffs along a flat-bottomed envelope, shade under body. */
function paintCloud(ctx: CanvasRenderingContext2D, w: number, h: number, rng: () => number) {
  const baseY = h * 0.62;
  const puffs: { x: number; y: number; r: number }[] = [];
  const n = 14 + Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const x = w * (0.14 + 0.72 * f) + (rng() - 0.5) * w * 0.05;
    // Tallest in the middle, flat along the bottom — cumulus, not fog.
    const envelope = Math.sin(Math.PI * f) ** 0.8;
    const r = h * (0.1 + 0.2 * envelope) * (0.8 + rng() * 0.45);
    const y = baseY - r * (0.35 + rng() * 0.75 * envelope);
    puffs.push({ x, y, r });
  }
  // Shade pass — a warm grey belly under everything.
  for (const p of puffs) {
    const g = ctx.createRadialGradient(p.x, p.y + p.r * 0.3, p.r * 0.1, p.x, p.y + p.r * 0.3, p.r * 1.18);
    g.addColorStop(0, "rgba(158, 152, 134, 0.72)");
    g.addColorStop(1, "rgba(158, 152, 134, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y + p.r * 0.3, p.r * 1.15, 0, Math.PI * 2);
    ctx.fill();
  }
  // Body pass — milk, lit from above.
  for (const p of puffs) {
    const g = ctx.createRadialGradient(p.x - p.r * 0.12, p.y - p.r * 0.22, p.r * 0.08, p.x, p.y, p.r);
    g.addColorStop(0, "rgba(255, 255, 255, 1)");
    g.addColorStop(0.58, "rgba(255, 253, 246, 0.94)");
    g.addColorStop(1, "rgba(255, 253, 246, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Cheap two-step blur: draw small, draw back big. */
function blurred(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = Math.max(2, Math.round(src.width / factor));
  small.height = Math.max(2, Math.round(src.height / factor));
  small.getContext("2d")!.drawImage(src, 0, 0, small.width, small.height);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function makeSprites(seed: number) {
  const clouds: HTMLCanvasElement[] = [];
  const shadows: HTMLCanvasElement[] = [];
  for (let v = 0; v < 3; v++) {
    const rng = mulberry32(seed + v * 101);
    const c = document.createElement("canvas");
    c.width = 560;
    c.height = 300;
    paintCloud(c.getContext("2d")!, c.width, c.height, rng);
    const soft = blurred(c, 1.9);
    clouds.push(soft);

    // The shadow is the same silhouette in ink, blurred wider.
    const tint = document.createElement("canvas");
    tint.width = c.width;
    tint.height = c.height;
    const tctx = tint.getContext("2d")!;
    tctx.drawImage(soft, 0, 0);
    tctx.globalCompositeOperation = "source-in";
    tctx.fillStyle = "#22221e";
    tctx.fillRect(0, 0, tint.width, tint.height);
    shadows.push(blurred(tint, 3.2));
  }
  return { clouds, shadows };
}

export function CloudLayer() {
  const { current: mapRef } = useMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const map = mapRef?.getMap();
    const canvas = canvasRef.current;
    if (!map || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const { clouds: cloudSprites, shadows: shadowSprites } = makeSprites(20260808);

    // Seed the sky around wherever the map opened; clouds recycle within a
    // ~4.5 km pasture so the weather never runs out.
    const center = map.getCenter();
    const cosLat = Math.cos((center.lat * Math.PI) / 180);
    const mToLng = (m: number) => m / (111320 * cosLat);
    const mToLat = (m: number) => m / 110574;
    const FIELD_M = 3400;

    const rng = mulberry32(7);
    const clouds: Cloud[] = Array.from({ length: CLOUD_COUNT }, () => ({
      lng: center.lng + mToLng((rng() * 2 - 1) * FIELD_M),
      lat: center.lat + mToLat((rng() * 2 - 1) * FIELD_M),
      sizeM: rng() < 0.6 ? 170 + rng() * 210 : 380 + rng() * 380,
      speed: reduced ? 0 : 5 + rng() * 6,
      heading: WIND_HEADING + (rng() - 0.5) * 0.5,
      sprite: Math.floor(rng() * 3),
      wobble: rng() * Math.PI * 2,
    }));

    let raf = 0;
    let last = performance.now();
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const { clientWidth, clientHeight } = canvas.parentElement ?? canvas;
      canvas.width = Math.round(clientWidth * dpr);
      canvas.height = Math.round(clientHeight * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

      // Ground scale: metres → screen pixels, measured through the projection
      // itself so pitch/zoom/rotation all come along for free.
      const c = map.getCenter();
      const p0 = map.project([c.lng, c.lat]);
      const p1 = map.project([c.lng + mToLng(100), c.lat]);
      const pxPerM = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 100;

      const zoom = map.getZoom();
      const pitch = (map.getPitch() * Math.PI) / 180;
      // 0 = high above the weather · 1 = down on the ground beneath it.
      const under = smoothstep(ABOVE_Z, UNDER_Z, zoom);
      const cloudAlpha = (1 - under) * 0.96;
      const shadowAlpha = 0.11 + 0.11 * under;
      const squash = Math.max(0.42, Math.cos(pitch));
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      for (const cl of clouds) {
        // Drift, then wrap back across the upwind fence.
        const step = cl.speed * dt;
        cl.lng += mToLng(Math.sin(cl.heading) * step);
        cl.lat += mToLat(Math.cos(cl.heading) * step);
        if (cl.lng > center.lng + mToLng(FIELD_M)) cl.lng -= mToLng(FIELD_M * 2);
        if (cl.lat < center.lat - mToLat(FIELD_M)) cl.lat += mToLat(FIELD_M * 2);

        const spriteW = cl.sizeM * pxPerM;
        if (spriteW < 7) continue;
        const spriteH = spriteW * 0.5;

        // Shadow — pressed on the ground, offset by the sun, squashed by pitch.
        if (shadowAlpha > 0.01) {
          const sp = map.project([cl.lng + mToLng(SHADOW_OFFSET_M[0]), cl.lat - mToLat(SHADOW_OFFSET_M[1])]);
          const sw = spriteW;
          const sh = spriteH * squash;
          if (sp.x > -sw && sp.x < w + sw && sp.y > -sh && sp.y < h + sh) {
            ctx.globalAlpha = shadowAlpha;
            ctx.drawImage(shadowSprites[cl.sprite], sp.x - sw / 2, sp.y - sh / 2, sw, sh);
          }
        }

        // The cloud itself — lifted off its ground point when the camera tilts,
        // with a barely-there breathe so the sky never reads as a still image.
        if (cloudAlpha > 0.01) {
          const p = map.project([cl.lng, cl.lat]);
          const lift = Math.min(160, 340 * pxPerM * Math.tan(pitch) * 0.5);
          const breathe = 1 + Math.sin(now / 9000 + cl.wobble) * 0.02;
          const cw = spriteW * 1.04 * breathe;
          const ch = spriteH * breathe;
          const y = p.y - lift;
          if (p.x > -cw && p.x < w + cw && y > -ch && y < h + ch) {
            ctx.globalAlpha = cloudAlpha;
            ctx.drawImage(cloudSprites[cl.sprite], p.x - cw / 2, y - ch / 2, cw, ch);
          }
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mapRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ zIndex: 5 }}
    />
  );
}
