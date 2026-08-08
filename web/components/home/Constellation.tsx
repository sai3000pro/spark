"use client";

/**
 * The intro's night sky: ~900 points of light that drift like fireflies and,
 * as the visitor scrolls, converge onto the day's REAL route — the odometry
 * polyline from the trip data, not an invented squiggle. The product material
 * (a Gaussian splat is a cloud of captured light) demonstrated with the
 * product's own data.
 *
 * Driven from outside via the imperative handle: the GSAP timeline owns scroll
 * scrubbing and calls setProgress(p); the canvas owns only ambient time. The
 * drift amplitude collapses as p→1 so converged points sit still like a
 * long-exposure photograph.
 *
 * Perf: DPR capped at 2, points batched into three alpha buckets per frame,
 * paused off-screen and on hidden tabs. Under prefers-reduced-motion the
 * caller renders the static route SVG instead and this component is ABSENT.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AURORA, GOLD, STARLIGHT } from "@/lib/theme";

export interface ConstellationHandle {
  /** 0 = free drift · 1 = fully converged on the route. */
  setProgress: (p: number) => void;
}

interface Props {
  /** Route polyline in unit space (x right, y down, already aspect-fitted). */
  route: Array<[number, number]>;
  className?: string;
}

interface Point {
  hx: number; // home (drift anchor)
  hy: number;
  tx: number; // target on the route
  ty: number;
  r: number;
  phase: number; // twinkle phase
  speed: number; // twinkle speed
  wander: number; // drift amplitude, px
  stagger: number; // 0..0.5 — later points start converging later
  color: string;
}

const COUNT = 900;

/** Deterministic LCG so SSR/client agree if this ever renders server-side. */
function makeRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const Constellation = forwardRef<ConstellationHandle, Props>(function Constellation(
  { route, className = "" },
  handle,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progress = useRef(0);

  useImperativeHandle(handle, () => ({
    setProgress: (p) => {
      progress.current = Math.max(0, Math.min(1, p));
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let points: Point[] = [];
    let raf = 0;
    let running = false;
    let visible = true;

    // Cumulative arc lengths → even distribution of targets along the walk.
    const segs: number[] = [0];
    for (let i = 1; i < route.length; i++) {
      const dx = route[i][0] - route[i - 1][0];
      const dy = route[i][1] - route[i - 1][1];
      segs.push(segs[i - 1] + Math.hypot(dx, dy));
    }
    const total = segs[segs.length - 1] || 1;

    const alongRoute = (f: number): [number, number] => {
      const d = f * total;
      let i = 1;
      while (i < segs.length - 1 && segs[i] < d) i++;
      const f2 = (d - segs[i - 1]) / (segs[i] - segs[i - 1] || 1);
      return [
        route[i - 1][0] + (route[i][0] - route[i - 1][0]) * f2,
        route[i - 1][1] + (route[i][1] - route[i - 1][1]) * f2,
      ];
    };

    const build = () => {
      const rng = makeRng(20260802);
      // Fit the unit-space route into the canvas with generous padding.
      const pad = Math.min(w, h) * 0.18;
      const scale = Math.min(w - pad * 2, h - pad * 2);
      const ox = (w - scale) / 2;
      const oy = (h - scale) / 2;

      points = Array.from({ length: COUNT }, () => {
        const [ux, uy] = alongRoute(rng());
        const roll = rng();
        return {
          hx: rng() * w,
          hy: rng() * h,
          tx: ox + ux * scale + (rng() - 0.5) * 14,
          ty: oy + uy * scale + (rng() - 0.5) * 14,
          r: 0.6 + rng() * 1.7,
          phase: rng() * Math.PI * 2,
          speed: 0.3 + rng() * 0.9,
          wander: 14 + rng() * 40,
          stagger: rng() * 0.5,
          color: roll < 0.07 ? GOLD : roll < 0.12 ? AURORA : STARLIGHT,
        };
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

    const frame = (now: number) => {
      raf = 0;
      if (!running) return;
      const t = now / 1000;
      const p = progress.current;
      ctx.clearRect(0, 0, w, h);
      // 'lighter' makes overlapping points bloom like long-exposure light.
      ctx.globalCompositeOperation = "lighter";

      for (const pt of points) {
        const pe = easeInOut(Math.max(0, Math.min(1, (p - pt.stagger) / (1 - pt.stagger))));
        const amp = pt.wander * (1 - pe * 0.92);
        const dx = Math.sin(t * pt.speed + pt.phase) * amp;
        const dy = Math.cos(t * pt.speed * 0.8 + pt.phase * 1.7) * amp;
        const x = pt.hx + (pt.tx - pt.hx) * pe + dx;
        const y = pt.hy + (pt.ty - pt.hy) * pe + dy;
        const tw = 0.45 + 0.55 * Math.sin(t * pt.speed * 2.1 + pt.phase) ** 2;
        ctx.globalAlpha = tw * (0.28 + 0.5 * pe);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(x, y, pt.r + pe * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!running && visible && !document.hidden) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);

    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [route]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
});
