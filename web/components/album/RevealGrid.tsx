"use client";

/**
 * Album tiles animating in as they arrive.
 *
 * IntersectionObserver rather than the newer `animation-timeline: view()`, for
 * one deciding reason: globals.css forces `animation-duration: 0.01ms !important`
 * under reduced motion, and on a PROGRESS-based timeline duration scales
 * progress rather than time — the tiles would snap to a keyframe and stick
 * there. Scroll-driven animations also replay in both directions by design, so
 * play-once would need JS anyway.
 *
 * This component IS the grid element, so `grid-cols-*` still applies directly to
 * the tiles. It takes `children` as a prop, so AlbumGallery stays a Server
 * Component and the tiles themselves are never bundled to the client.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PATTERN IS INVERTED FROM THE USUAL ONE, ON PURPOSE.
 *
 * The conventional version puts `.reveal { opacity: 0 }` in the stylesheet and
 * hopes JS arrives to remove it. Here the stylesheet only reacts to a data
 * attribute that JS itself writes. So if the bundle 404s, hydration throws,
 * IntersectionObserver is missing, or JS is off entirely, the grid renders
 * exactly as the server painted it. Content is never hidden by CSS alone.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { useEffect, useRef, type ReactNode } from "react";

const STAGGER_MS = 45;
/** Cap the stagger so a wide row still finishes quickly: 5 x 45 = 225ms. */
const MAX_STEPS = 5;

export function RevealGrid({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    if (typeof IntersectionObserver === "undefined") return;
    // PRIMARY reduced-motion gate. No attribute is ever written, so the tiles
    // stay exactly as the server painted them. The CSS block in globals.css is
    // the secondary net for someone who toggles the OS setting mid-session.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const tiles = Array.from(root.children) as HTMLElement[];
    // One batched read pass, then one batched write pass — a single forced
    // layout for the whole grid and never again. There is no scroll listener.
    const alreadyVisible = tiles.map((el) => el.getBoundingClientRect().top <= window.innerHeight * 0.9);

    const io = new IntersectionObserver(
      (entries) => {
        // Entry order is unspecified; sort into DOM order so the stagger runs in
        // reading order rather than observer order.
        const arrived = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => tiles.indexOf(a.target as HTMLElement) - tiles.indexOf(b.target as HTMLElement),
          );

        arrived.forEach((entry, i) => {
          const el = entry.target as HTMLElement;
          el.style.setProperty("--reveal-delay", `${Math.min(i, MAX_STEPS) * STAGGER_MS}ms`);
          el.dataset.reveal = "in";
          io.unobserve(el); // play once, permanently
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );

    for (let i = 0; i < tiles.length; i++) {
      // Never yank away something the user can already see — this is the
      // deep-link and restored-scroll case.
      if (alreadyVisible[i]) continue;
      tiles[i].dataset.reveal = "out";
      io.observe(tiles[i]);
    }

    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
