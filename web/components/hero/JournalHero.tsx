"use client";

/**
 * The hero: the journal's own night, built in layers instead of painted flat.
 *
 * Back to front — a deep pine sky wearing the halftone print screen, the
 * shader aurora (AuroraVeil) hanging in it, then three planes of generated
 * riso-print forest (public/hero/journal/*.webp, keyed from white): a misty
 * far treeline, a mid band, and two near wings that frame the copy. Fog
 * gradients sit between the planes so depth reads as air, not as stacking.
 * The blob companion sleeps on the ground among brass fireflies — it is the
 * same live start-a-trip button the aurora scene had; its chrome tokens are
 * remapped to journal pigments in globals.css.
 *
 * Motion (all gated on prefers-reduced-motion):
 *   · the headline's two lines rise out of per-line masks, and the last line
 *     rolls all evening — up through its mask, in from below, ink still wet
 *   · pointer parallax: each plane leans away from the cursor by its depth
 *   · scroll parallax: planes fall behind at different rates as you leave
 *   · fireflies drift and twinkle on pure CSS
 *
 * Type is the journal's: Schibsted headline, fnote specimen tag, brass pill.
 */
import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ArrowDown, Plus } from "lucide-react";
import { AuroraVeil } from "@/components/hero/AuroraVeil";
import { HeroBlobButton } from "@/components/hero/HeroBlobButton";

gsap.registerPlugin(ScrollTrigger, CustomEase);

const HERO_CYCLE = ["in light.", "in place.", "in sound."];

/** left%, top%, drift-x px, drift-y px, duration s, delay s */
const FIREFLIES: Array<[number, number, number, number, number, number]> = [
  [18, 66, 22, -16, 9.5, 0],
  [27, 74, -16, -20, 11, 1.4],
  [40, 81, 18, -10, 8.5, 0.6],
  [58, 78, -20, -14, 10.5, 2.1],
  [73, 70, 14, -18, 9, 0.9],
  [83, 63, -12, -10, 12, 2.8],
  [64, 86, 10, -8, 7.5, 1.7],
];

export function JournalHero({ dateLabel, placeLabel }: { dateLabel: string; placeLabel: string }) {
  const root = useRef<HTMLElement>(null);
  const heroWord = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // This effect runs before Landing's (children mount first), so the shared
    // eases register here too — same beziers, same names, idempotent.
    if (!CustomEase.get("signature")) CustomEase.create("signature", "0.785,0.135,0.15,0.86");
    if (!CustomEase.get("reveal")) CustomEase.create("reveal", "0.5,0,0,1");

    const mm = gsap.matchMedia(root);

    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current!;
      const killers: Array<() => void> = [];

      // The two lines rise out of their masks on arrival.
      const heroIn = gsap.from(el.querySelectorAll("[data-hero-line]"), {
        yPercent: 110,
        duration: 1.1,
        ease: "reveal",
        stagger: 0.12,
        delay: 0.1,
      });
      killers.push(() => heroIn.kill());

      // The last line rolls all evening: up and out through the mask, the
      // next one in from below with the ink still wet.
      let wi = 0;
      const cycle = () => {
        const node = heroWord.current;
        if (!node) return;
        gsap
          .timeline()
          .to(node, {
            yPercent: -112,
            filter: "blur(5px)",
            duration: 0.5,
            ease: "signature",
            onComplete: () => {
              wi = (wi + 1) % HERO_CYCLE.length;
              node.textContent = HERO_CYCLE[wi];
            },
          })
          .fromTo(
            node,
            { yPercent: 115, filter: "blur(5px)" },
            { yPercent: 0, filter: "blur(0px)", duration: 0.65, ease: "reveal" },
          );
      };
      const cycleIv = window.setInterval(cycle, 3400);
      killers.push(() => window.clearInterval(cycleIv));

      // Pointer parallax — each plane leans away from the cursor by depth.
      const planes = Array.from(el.querySelectorAll<HTMLElement>("[data-plx]"));
      const movers = planes.map((p) => {
        const d = Number(p.dataset.plx ?? 1);
        return {
          x: gsap.quickTo(p, "x", { duration: 0.9, ease: "power2.out" }),
          y: gsap.quickTo(p, "y", { duration: 0.9, ease: "power2.out" }),
          d,
        };
      });
      const onMove = (e: MouseEvent) => {
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        for (const m of movers) {
          m.x(-nx * m.d * 7);
          m.y(-ny * m.d * 3.5);
        }
      };
      el.addEventListener("mousemove", onMove);
      killers.push(() => el.removeEventListener("mousemove", onMove));

      // Scroll parallax — the forest falls behind at depth rates on the way out.
      planes.forEach((p) => {
        const d = Number(p.dataset.plx ?? 1);
        const t = gsap.to(p, {
          yPercent: d * 4.5,
          ease: "none",
          scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: 0.4 },
        });
        killers.push(() => {
          t.scrollTrigger?.kill();
          t.kill();
        });
      });

      return () => killers.forEach((k) => k());
    });

    return () => mm.revert();
  }, []);

  return (
    <section
      ref={root}
      aria-label="Introduction"
      className="journal-hero dotfield starfield relative -mt-[57px] h-svh min-h-[660px] overflow-hidden pt-[57px]"
      style={
        {
          background:
            "linear-gradient(180deg, #0c181c 0%, #16292e 42%, #22373c 74%, #142428 100%)",
          "--blob-cx": 0.71,
          "--blob-feet-y": 0.92,
          "--blob-h": 0.15,
        } as React.CSSProperties
      }
    >
      {/* The aurora, hanging in the upper sky. */}
      <AuroraVeil className="pointer-events-none absolute inset-x-0 top-0 h-[58%]" />

      {/* The far treeline — a misty band a valley away, lifted toward the
          fog color so it reads as distance. */}
      <div data-plx="1" className="pointer-events-none absolute inset-x-[-3%]" style={{ bottom: "30%", height: "17%" }}>
        <img
          src="/hero/journal/treeline.webp"
          alt=""
          aria-hidden
          draggable={false}
          className="h-full w-full select-none object-cover object-top"
          style={{ opacity: 0.42, filter: "brightness(2.2) saturate(0.5)" }}
        />
      </div>
      {/* Valley fog between the far and mid planes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0"
        style={{
          bottom: "24%",
          height: "20%",
          background:
            "linear-gradient(180deg, rgb(169 189 185 / 0) 0%, rgb(169 189 185 / 0.12) 55%, rgb(169 189 185 / 0) 100%)",
        }}
      />

      {/* The mid forest band — hazier, halfway into the fog. */}
      <div data-plx="2" className="pointer-events-none absolute inset-x-[-4%]" style={{ bottom: "6%", height: "34%" }}>
        <img
          src="/hero/journal/trees.webp"
          alt=""
          aria-hidden
          draggable={false}
          className="h-full w-full select-none object-cover object-top"
          style={{ opacity: 0.55, filter: "brightness(1.5) saturate(0.6)" }}
        />
      </div>
      {/* Ground fog at the mid band's feet. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0"
        style={{
          bottom: "4%",
          height: "14%",
          background:
            "linear-gradient(180deg, rgb(169 189 185 / 0) 0%, rgb(169 189 185 / 0.1) 60%, rgb(169 189 185 / 0) 100%)",
        }}
      />

      {/* The near wings — big pressed prints framing the page's edges, the
          trunks sinking below the fold. */}
      <img
        src="/hero/journal/trees.webp"
        alt=""
        aria-hidden
        data-plx="3"
        draggable={false}
        className="pointer-events-none absolute bottom-[-9%] left-[-12%] w-[48%] max-w-none select-none"
        style={{ filter: "brightness(0.82)" }}
      />
      <img
        src="/hero/journal/trees.webp"
        alt=""
        aria-hidden
        data-plx="3"
        draggable={false}
        className="pointer-events-none absolute bottom-[-10%] right-[-14%] w-[44%] max-w-none -scale-x-100 select-none"
        style={{ filter: "brightness(0.78)" }}
      />

      {/* The ground the walk starts on, and the path's warm pool. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[14%]"
        style={{
          background: "linear-gradient(180deg, rgb(12 22 25 / 0) 0%, #0e1c20 58%, #0c181c 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: "calc(var(--blob-cx) * 100% - 17vmin)",
          bottom: "2%",
          width: "34vmin",
          height: "11vmin",
          background:
            "radial-gradient(ellipse at center, rgb(213 180 115 / 0.16) 0%, rgb(213 180 115 / 0) 68%)",
        }}
      />

      {/* Fireflies, drifting between the trees. */}
      {FIREFLIES.map(([l, t, dx, dy, dur, delay], i) => (
        <span
          key={i}
          aria-hidden
          className="jh-fly"
          style={
            {
              left: `${l}%`,
              top: `${t}%`,
              "--fx": `${dx}px`,
              "--fy": `${dy}px`,
              "--fd": `${dur}s`,
              "--fdel": `${delay}s`,
            } as React.CSSProperties
          }
        />
      ))}

      {/* The companion, asleep on the path — the app's primary action. */}
      <HeroBlobButton />

      {/* ── The promise, in the journal's own voice ─────────────────────── */}
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col items-center px-5 pt-[9vh] text-center sm:px-8">
        <p className="fnote text-[11.5px] text-mist" data-reveal>
          [ {dateLabel} · {placeLabel} ]
        </p>
        <h1 className="mt-6 text-[clamp(2.9rem,7vw,6rem)] leading-[1.04] text-milk">
          <span className="-mb-[0.12em] block overflow-hidden pb-[0.12em]">
            <span data-hero-line className="block">
              A day, remembered
            </span>
          </span>
          <span className="-mb-[0.12em] block overflow-hidden pb-[0.12em]">
            <span data-hero-line className="block text-brass">
              <span ref={heroWord} className="inline-block" style={{ willChange: "transform, filter" }}>
                {HERO_CYCLE[0]}
              </span>
            </span>
          </span>
        </h1>
        <p
          data-reveal
          style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
          className="mt-6 max-w-[50ch] text-[15px] leading-relaxed text-mist sm:text-[16.5px]"
        >
          Spark follows a metre behind your walk, decides on its own which minutes
          mattered, and rebuilds them as clouds of light pinned to the real city.
        </p>
        <div
          data-reveal
          style={{ "--reveal-delay": "240ms" } as React.CSSProperties}
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link href="/walk" className="pill-brass px-6 py-3 text-[15px]">
            <Plus size={15} strokeWidth={2} aria-hidden />
            Step into the walk
          </Link>
          <a href="#decides" className="pill-ghost px-6 py-3 text-[15px] text-milk">
            How it decides
          </a>
        </div>
      </div>

      {/* The way down into the journal. */}
      <a
        href="#journal"
        className="fnote absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 px-3 py-2 text-[10.5px] text-mist/85 transition-colors hover:text-milk"
      >
        The journal
        <ArrowDown size={12} strokeWidth={1.75} aria-hidden />
      </a>
    </section>
  );
}
