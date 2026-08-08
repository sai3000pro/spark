"use client";

/**
 * The landing: the robot's field journal, told as scroll cinema.
 *
 * 0   The storm — one mono word, NOTICED, on grainy paper. Scrolling presses
 *     every detection of the day onto the page as specimen chips, until an
 *     ink panel cuts in: "It noticed 1,204 things. It kept six."
 * I   Hero — pine ground, halftone dots, the promise with a blur-cycling
 *     last line, and the kept moments lapping underneath.
 * II  How it decides — a smeared marquee band, then Seen / Weighed / Kept as
 *     three dark plates with real numbers counting up.
 * III Six moments, kept — the journal spreads, with a [ DISCARDED ] toggle
 *     that shows what didn't make it and why. Honesty as an interaction.
 * IV  A giant statement dragged across the page by the scroll.
 * V   The field notes — an accordion of the questions people actually ask.
 * VI  Finale — pine again, the giant wordmark behind one pane of glass.
 *
 * Motion contract (DESIGN.md v5): markup defaults are the FINAL state and JS
 * animates FROM elsewhere — no-JS and reduced-motion get a complete page
 * (the storm rests on its ink panel). Lenis is desktop-only; the pinned
 * storm, reveals and count-ups run wherever motion is allowed. Exactly two
 * eases, registered under the same names as the CSS custom properties.
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import Lenis from "lenis";
import { ArrowDown, ArrowUpRight, Music, Plus, RotateCw } from "lucide-react";
import { KeyframeImg } from "@/components/system/ui";
import { BRASS, CLAY, MILK, MOSS, PINE } from "@/lib/theme";

export interface LandingMoment {
  id: string;
  title: string;
  summary: string;
  clock: string;
  length: string;
  place: string;
  mood: string;
  hasMusic: boolean;
  seed: number;
  hue?: number;
  url?: string;
}

export interface LandingDiscard {
  id: string;
  clock: string;
  length: string;
  trigger: string;
  reason: string;
  score: number;
}

export interface LandingProps {
  dateLabel: string;
  placeLabel: string;
  stats: {
    distance: string;
    duration: string;
    detections: string;
    detectionsRaw: number;
    candidates: number;
    moments: number;
    objects: number;
  };
  noticed: string[];
  moments: LandingMoment[];
  discards: LandingDiscard[];
}

gsap.registerPlugin(ScrollTrigger, CustomEase);

/* Deterministic PRNG — the storm must lay out identically on server and client. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The pressed-ink chip wardrobe — cycled pseudo-randomly across the storm. */
const CHIP_LOOKS = [
  "bg-ink text-paper",
  "bg-spruce text-milk",
  "bg-brass text-ink",
  "bg-moss text-paper",
  "bg-clay text-paper",
  "bg-lagoon text-milk",
  "bg-vellum text-ink shadow-[inset_0_0_0_1px_rgb(27_27_24_/_0.25)]",
];

const HERO_CYCLE = ["in light.", "in place.", "in sound."];

/* Where a moment's dot lands on paper — the journal's own ink cycle. */
const PAPER_INKS = ["#8a6d2f", "#7d7730", "#cf5e32", "#476d73", "#2c4347", "#1b1b18"];

export function Landing({ dateLabel, placeLabel, stats, noticed, moments, discards }: LandingProps) {
  const root = useRef<HTMLDivElement>(null);
  const heroWord = useRef<HTMLSpanElement>(null);
  const [shelf, setShelf] = useState<"kept" | "discarded">("kept");
  const [note, setNote] = useState(0);

  const chips = useMemo(() => {
    const rand = mulberry32(0x5eed);
    // Rounded — full-precision floats can serialize differently between the
    // server and client renders, which trips hydration.
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return Array.from({ length: 128 }, (_, i) => ({
      word: noticed[i % noticed.length],
      left: r2(1 + rand() * 90),
      top: r2(2 + rand() * 92),
      look: CHIP_LOOKS[Math.floor(rand() * CHIP_LOOKS.length)],
      scale: r2(0.8 + rand() * 0.45),
    }));
  }, [noticed]);

  useEffect(() => {
    // Same beziers as --ease-signature / --ease-reveal in globals.css, so JS
    // motion and CSS motion are literally identical.
    if (!CustomEase.get("signature")) CustomEase.create("signature", "0.785,0.135,0.15,0.86");
    if (!CustomEase.get("reveal")) CustomEase.create("reveal", "0.5,0,0,1");

    const mm = gsap.matchMedia(root);

    // ── Smooth scroll: desktop only ─────────────────────────────────────
    mm.add("(min-width: 1025px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis();
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      return () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    });

    // ── Everything else: wherever motion is allowed ─────────────────────
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const el = root.current!;
      document.documentElement.classList.add("reveal-armed");

      // The storm. Markup's final state is the ink panel; motion starts from
      // the bare word and presses chips on as the scroll advances.
      const chipsEls = el.querySelectorAll<HTMLElement>(".storm-chip");
      const intro = gsap
        .timeline({
          scrollTrigger: {
            trigger: "[data-storm]",
            start: "top top",
            end: "+=280%",
            scrub: 0.35,
            pin: true,
            anticipatePin: 1,
          },
        })
        .set("[data-storm-cut]", { autoAlpha: 0 }, 0)
        .from(
          chipsEls,
          {
            autoAlpha: 0,
            scale: 0.4,
            ease: "none",
            stagger: { each: 2.0 / Math.max(chipsEls.length, 1), from: "random" },
          },
          0.12,
        )
        .to("[data-storm-hint]", { autoAlpha: 0, duration: 0.2 }, 0.3)
        .to("[data-storm-cut]", { autoAlpha: 1, duration: 0.55, ease: "signature" }, 2.35)
        .from(
          "[data-storm-cut] [data-cut-line]",
          { yPercent: 60, autoAlpha: 0, stagger: 0.18, duration: 0.5, ease: "reveal" },
          2.5,
        )
        .to({}, { duration: 0.5 });

      // Hero last line cycles with a wet-ink blur.
      let wi = 0;
      const cycle = () => {
        const node = heroWord.current;
        if (!node) return;
        gsap
          .timeline()
          .to(node, {
            filter: "blur(10px)",
            opacity: 0,
            duration: 0.45,
            ease: "signature",
            onComplete: () => {
              wi = (wi + 1) % HERO_CYCLE.length;
              node.textContent = HERO_CYCLE[wi];
            },
          })
          .to(node, { filter: "blur(0px)", opacity: 1, duration: 0.5, ease: "signature" });
      };
      const cycleIv = window.setInterval(cycle, 3400);

      // The dragged statement — scrubbed across its section.
      const drag = gsap.fromTo(
        "[data-statement-track]",
        { xPercent: 3 },
        {
          xPercent: -32,
          ease: "none",
          scrollTrigger: {
            trigger: "[data-statement]",
            start: "top bottom",
            end: "bottom top",
            scrub: 0.4,
          },
        },
      );

      // One-shot reveals.
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.state = "in";
            io.unobserve(e.target);
          }
        },
        { threshold: 0.2 },
      );
      el.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));

      // Count-ups fire once, to the real number already in the markup.
      const counterTriggers: ScrollTrigger[] = [];
      el.querySelectorAll<HTMLElement>("[data-count]").forEach((n) => {
        const target = Number(n.dataset.count);
        const proxy = { v: target };
        counterTriggers.push(
          ScrollTrigger.create({
            trigger: n,
            start: "top 85%",
            once: true,
            onEnter: () => {
              proxy.v = 0;
              gsap.to(proxy, {
                v: target,
                duration: 1.4,
                ease: "reveal",
                onUpdate: () => {
                  n.textContent = Math.round(proxy.v).toLocaleString("en-CA");
                },
              });
            },
          }),
        );
      });

      return () => {
        window.clearInterval(cycleIv);
        intro.scrollTrigger?.kill();
        intro.kill();
        drag.scrollTrigger?.kill();
        drag.kill();
        io.disconnect();
        counterTriggers.forEach((t) => t.kill());
        document.documentElement.classList.remove("reveal-armed");
      };
    });

    return () => mm.revert();
  }, []);

  const noticedFmt = stats.detectionsRaw.toLocaleString("en-CA");
  const maxScore = Math.max(...discards.map((d) => d.score), 1);

  return (
    <div ref={root} className="field-site relative bg-paper text-ink">
      {/* ── 0 · the storm ────────────────────────────────────────────────── */}
      <section
        data-storm
        className="papergrain relative h-svh min-h-[560px] overflow-hidden bg-paper"
        aria-label="Everything the robot noticed today"
      >
        {/* The seed word, alone on the page. */}
        <p className="fnote absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[clamp(15px,1.6vw,21px)] tracking-[0.32em] text-ink">
          NOTICED
        </p>

        {/* The storm — every chip a real thing from today's walk. */}
        <div aria-hidden className="absolute inset-0">
          {chips.map((c, i) => (
            <span
              key={i}
              className={`storm-chip word-chip absolute ${c.look} ${i > 72 ? "hidden md:inline-flex" : ""}`}
              style={{
                left: `${c.left}%`,
                top: `${c.top}%`,
                transform: `scale(${c.scale})`,
              }}
            >
              {c.word}
            </span>
          ))}
        </div>

        <p
          data-storm-hint
          className="fnote absolute inset-x-0 bottom-9 z-10 flex flex-col items-center gap-2 text-center text-[11px] text-ink-faint"
        >
          Scroll down
          <ArrowDown size={12} strokeWidth={1.75} aria-hidden />
        </p>

        {/* The cut — the storm's final state, and the whole page for no-JS. */}
        <div
          data-storm-cut
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-ink px-6 text-center"
        >
          <p data-cut-line className="fnote text-[clamp(14px,1.5vw,19px)] tracking-[0.3em] text-paper">
            It noticed {noticedFmt} things.
          </p>
          <p data-cut-line className="fnote text-[clamp(14px,1.5vw,19px)] tracking-[0.3em] text-brass">
            It kept six.
          </p>
        </div>
      </section>

      {/* Everything after the storm shares the sticky nav. */}
      <div className="relative">
        <header className="glass-bar sticky top-0 z-40 flex items-center justify-between px-5 py-3 text-milk sm:px-8">
          <Link href="/" className="flex items-baseline gap-0.5 text-[20px] font-semibold tracking-tight" aria-label="Spark home">
            spark
            <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-clay" />
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/walk" className="hidden text-[13.5px] text-milk/85 transition-opacity hover:text-milk sm:block">
              The walk
            </Link>
            <Link href="/detect" className="hidden text-[13.5px] text-milk/85 transition-opacity hover:text-milk sm:block">
              Detector bench
            </Link>
            <Link href="/walk" className="pill-brass px-4 py-2 text-[13px]">
              <Plus size={14} strokeWidth={2} aria-hidden />
              Step into the walk
            </Link>
          </nav>
        </header>

        {/* ── I · hero ───────────────────────────────────────────────────── */}
        <section
          className="dotfield starfield relative -mt-[57px] flex min-h-svh flex-col overflow-hidden bg-pine pt-[57px]"
          aria-label="Introduction"
        >
          <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-5 py-24 text-center sm:px-8">
            <p className="fnote text-[11.5px] text-mist" data-reveal>
              [ {dateLabel} · {placeLabel} ]
            </p>
            <h1
              data-reveal
              className="mt-6 text-[clamp(2.9rem,7vw,6rem)] leading-[1.02] text-milk"
            >
              A day, remembered
              <br />
              <span
                ref={heroWord}
                className="inline-block text-brass"
                style={{ willChange: "filter, opacity" }}
              >
                {HERO_CYCLE[0]}
              </span>
            </h1>
            <p data-reveal className="mt-7 max-w-[52ch] text-[15.5px] leading-relaxed text-mist sm:text-[17px]">
              Spark follows a metre behind your walk, decides on its own which minutes
              mattered, and rebuilds them as clouds of light pinned to the real park.
            </p>
            <div data-reveal className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link href="/walk" className="pill-brass px-5 py-2.5 text-[14px]">
                <Plus size={15} strokeWidth={2} aria-hidden />
                Step into the walk
              </Link>
              <a href="#decides" className="pill-ghost px-5 py-2.5 text-[14px] text-milk">
                How it decides
              </a>
            </div>
          </div>

          {/* The kept moments, lapping like a ticker of the day. */}
          <div
            aria-hidden
            className="relative z-10 overflow-hidden border-t border-milk/10 py-4"
            style={{
              maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
              WebkitMaskImage:
                "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
            }}
          >
            <div className="marquee-track flex w-max whitespace-nowrap" style={{ "--marquee-dur": "46s" } as React.CSSProperties}>
              {[0, 1].map((dup) => (
                <span key={dup} className="fnote text-[12px] tracking-[0.18em] text-brass/70">
                  {moments.map((mo) => `${mo.clock} — ${mo.title}`).join("  ·  ")}
                  {"  ·  "}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── II · how it decides ────────────────────────────────────────── */}
        <section
          id="decides"
          className="papergrain relative overflow-hidden"
          style={{
            background:
              "linear-gradient(180deg, var(--color-pine) 0%, #3d5652 16%, #b3ac8f 38%, var(--color-paper) 58%)",
          }}
          aria-label="How Spark decides"
        >
          {/* The smeared marquee band, half in the pine, half in the paper. */}
          <div
            aria-hidden
            className="overflow-hidden pb-6 pt-16"
            style={{
              maskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)",
              WebkitMaskImage:
                "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)",
            }}
          >
            <div
              className="marquee-track flex w-max items-center gap-8 whitespace-nowrap pl-8"
              style={{ "--marquee-dur": "30s" } as React.CSSProperties}
            >
              {Array.from({ length: 6 }, (_, i) => (
                <span
                  key={i}
                  className={`flex items-center gap-8 text-[clamp(2.6rem,6vw,5rem)] font-medium tracking-tight text-ink ${i % 2 === 1 ? "smear" : ""}`}
                >
                  How it decides
                  <RotateCw size={40} strokeWidth={1.5} aria-hidden className="shrink-0 opacity-70" />
                </span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto max-w-6xl px-5 pb-24 pt-10 sm:px-8 sm:pb-32">
            <p data-reveal className="max-w-[58ch] text-[15.5px] leading-relaxed text-ink-soft">
              No shutter button, no highlight reel by committee. The robot runs one sieve,
              all day: everything its cameras and mics notice, weighed for dwell, laughter,
              novelty and named things — and only the minutes that clear the line get kept.
            </p>

            <div className="mt-14 grid gap-5 lg:grid-cols-3">
              <SieveCard
                index="001"
                title="Seen"
                count={stats.detectionsRaw}
                caption="raw detections — every duck, bench and backpack the cameras noticed"
              >
                <DotMatrix />
              </SieveCard>
              <SieveCard
                index="002"
                title="Weighed"
                count={stats.candidates}
                caption="candidate windows scored on dwell, laughter, novelty and named things"
              >
                <ScoreBars candidates={stats.candidates} kept={stats.moments} />
              </SieveCard>
              <SieveCard
                index="003"
                title="Kept"
                count={stats.moments}
                caption="moments rebuilt in 3D, scored to music, pinned to the real park"
                accent
              >
                <PinRow />
              </SieveCard>
            </div>

            <div data-reveal className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/detect" className="pill-ghost px-5 py-2.5 text-[14px] text-ink">
                Open the detector bench
                <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
              </Link>
              <p className="fnote text-[11px] text-ink-faint">
                [ Synthetic previews say so · discards stay visible below ]
              </p>
            </div>
          </div>
        </section>

        {/* ── III · the journal spreads ──────────────────────────────────── */}
        <section className="papergrain relative bg-paper pb-28 pt-8 sm:pb-36" aria-label="The kept moments">
          <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h2 data-reveal className="text-[clamp(2.4rem,5vw,4rem)] leading-[1.04] text-spruce">
                Six moments, kept.
              </h2>
              <div
                data-reveal
                className="fnote flex rounded-full bg-vellum p-1 text-[11px] shadow-[inset_0_0_0_1px_rgb(27_27_24_/_0.14)]"
                role="tablist"
                aria-label="Kept or discarded"
              >
                {(["kept", "discarded"] as const).map((k) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={shelf === k}
                    onClick={() => setShelf(k)}
                    className={`rounded-full px-4 py-2 tracking-[0.16em] transition-colors duration-300 ${
                      shelf === k ? "bg-spruce text-milk" : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    {k === "kept" ? `KEPT · ${moments.length}` : `DISCARDED · ${discards.length}`}
                  </button>
                ))}
              </div>
            </div>

            {shelf === "kept" ? (
              <div className="mt-12 grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
                {moments.map((mo, i) => (
                  <Link
                    key={mo.id}
                    href={`/walk?m=${mo.id}`}
                    data-reveal
                    className="group relative block"
                  >
                    <article className="overflow-hidden rounded-[14px] bg-vellum shadow-[inset_0_0_0_1px_rgb(27_27_24_/_0.12),0_14px_30px_-18px_rgb(27_27_24_/_0.4)] transition-transform duration-300 ease-(--ease-signature) group-hover:-translate-y-1">
                      <div className="relative">
                        <KeyframeImg
                          keyframe={{ placeholderSeed: mo.seed, hue: mo.hue, url: mo.url }}
                          alt={`Keyframe stand-in for “${mo.title}”`}
                          width={840}
                          height={520}
                          className="aspect-[8/5] w-full object-cover"
                        />
                        {mo.hasMusic && (
                          <span className="fnote absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[9.5px] text-paper">
                            <Music size={10} strokeWidth={1.75} aria-hidden /> SCORED
                          </span>
                        )}
                      </div>
                      <div className="p-4">
                        <p className="fnote flex items-center gap-2 text-[10.5px] text-ink-faint">
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: PAPER_INKS[i % PAPER_INKS.length] }}
                          />
                          {mo.clock} · {mo.length} · {mo.place}
                        </p>
                        <h3 className="mt-2.5 text-[20px] leading-snug text-ink">{mo.title}</h3>
                        <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">
                          {mo.summary}
                        </p>
                        <p className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-clay">
                          Step inside
                          <ArrowUpRight
                            size={13}
                            strokeWidth={1.75}
                            className="transition-transform duration-300 ease-(--ease-signature) group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                            aria-hidden
                          />
                        </p>
                      </div>
                    </article>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="mt-12">
                <p className="max-w-[56ch] text-[14.5px] leading-relaxed text-ink-soft">
                  The sieve&apos;s rejects, kept on the record. Each one fired a real trigger —
                  and each one lost to something better. An honest journal shows its
                  crossed-out pages.
                </p>
                <ul className="mt-8 divide-y divide-ink/10 border-y border-ink/10">
                  {discards.map((d) => (
                    <li key={d.id} className="grid gap-2 py-5 sm:grid-cols-[110px_1fr_auto] sm:items-baseline sm:gap-6">
                      <p className="fnote text-[11px] text-ink-faint">{d.clock} · {d.length}</p>
                      <div>
                        <p className="text-[15px] text-ink">{d.trigger}</p>
                        <p className="mt-1 text-[13px] italic text-ink-soft">{d.reason}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-ink/10">
                          <span
                            className="block h-full rounded-full bg-clay/70"
                            style={{ width: `${Math.round((d.score / maxScore) * 100)}%` }}
                          />
                        </span>
                        <span className="fnote text-[10px] tracking-[0.2em] text-clay">[ DISCARDED ]</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="fnote mt-6 text-[11px] text-ink-faint">
                  [ Full audit trail on the detector bench ]
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── IV · the dragged statement ─────────────────────────────────── */}
        <section
          data-statement
          aria-label="Not every minute is worth keeping"
          className="relative overflow-hidden border-y border-ink/10 bg-paper py-16 sm:py-24"
        >
          <p
            data-statement-track
            className="whitespace-nowrap text-[clamp(3.4rem,9vw,7.5rem)] font-medium leading-none tracking-tight text-ink"
          >
            Not every minute is worth keeping. Six were. Not every minute is worth keeping.
          </p>
        </section>

        {/* ── V · field notes ────────────────────────────────────────────── */}
        <section className="papergrain relative bg-paper py-24 sm:py-32" aria-label="Field notes">
          <div className="relative mx-auto grid max-w-6xl gap-5 px-5 sm:px-8 lg:grid-cols-[minmax(280px,2fr)_3fr]">
            <div className="rounded-[14px] bg-vellum p-7 shadow-[inset_0_0_0_1px_rgb(27_27_24_/_0.12)] sm:p-9" data-reveal>
              <h2 className="text-[clamp(1.9rem,3vw,2.6rem)] leading-tight text-spruce">Field notes</h2>
              <div className="mt-6 border-t border-ink/15" />
              <ul className="mt-6 space-y-4">
                {FIELD_NOTES.map((q, i) => (
                  <li key={q.q}>
                    <button
                      onClick={() => setNote(i)}
                      aria-expanded={note === i}
                      className={`fnote flex items-center gap-2.5 text-left text-[12px] tracking-[0.16em] transition-colors duration-300 ${
                        note === i ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`text-[9px] transition-transform duration-300 ease-(--ease-signature) ${note === i ? "text-clay" : "opacity-0"}`}
                      >
                        ▶
                      </span>
                      [ {q.q} ]
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative rounded-[14px] bg-vellum p-7 shadow-[inset_0_0_0_1px_rgb(27_27_24_/_0.12)] sm:p-9" data-reveal>
              <p aria-hidden className="fnote absolute right-7 top-7 text-[12px] text-ink-faint">
                + ○ □
              </p>
              <div className="border-t border-ink/15 pt-6 sm:min-h-[240px]">
                {FIELD_NOTES[note].a.map((para) => (
                  <p key={para.slice(0, 24)} className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink-soft first:mt-0">
                    {para}
                  </p>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap gap-x-10 gap-y-6 border-t border-ink/15 pt-6">
                <Receipt value={stats.distance} label="walked, never in the way" />
                <Receipt value={stats.duration} label="of one Sunday evening" />
                <Receipt value={String(stats.objects)} label="things it can still point to" />
              </div>
            </div>
          </div>
        </section>

        {/* ── VI · finale ────────────────────────────────────────────────── */}
        <section className="dotfield starfield relative overflow-hidden bg-pine" aria-label="Enter the app">
          <div className="relative z-10 mx-auto max-w-6xl px-5 pt-24 sm:px-8 sm:pt-32">
            <div className="flex flex-wrap items-end justify-between gap-8">
              <h2 data-reveal className="text-[clamp(2.6rem,5.6vw,4.6rem)] leading-[1.05] text-milk">
                The walk is over…
                <br />
                <span className="text-brass">The memory isn{"'"}t.</span>
              </h2>
              <Link href="/walk" data-reveal className="pill-brass mb-2 px-5 py-2.5 text-[14px]">
                <Plus size={15} strokeWidth={2} aria-hidden />
                Step into the walk
              </Link>
            </div>
          </div>

          {/* The dim lap underneath, then the wordmark bleeding off the page. */}
          <div
            aria-hidden
            className="relative z-10 mt-16 overflow-hidden"
            style={{
              maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
              WebkitMaskImage:
                "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
            }}
          >
            <div
              className="marquee-track-reverse flex w-max items-center gap-10 whitespace-nowrap pl-10"
              style={{ "--marquee-dur": "38s" } as React.CSSProperties}
            >
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="flex items-center gap-10 text-[clamp(2.2rem,4.6vw,3.8rem)] font-medium tracking-tight text-milk/25">
                  Walk it back
                  <RotateCw size={32} strokeWidth={1.5} aria-hidden className="shrink-0 opacity-60" />
                </span>
              ))}
            </div>
          </div>

          <div className="relative mt-6">
            {/* One pane of glass — in flow on small screens, floating over the
                wordmark on large ones. */}
            <footer className="relative z-10 mx-4 mt-10 sm:mx-10 lg:absolute lg:bottom-[9vw] lg:left-1/2 lg:mx-0 lg:mt-0 lg:w-full lg:max-w-5xl lg:-translate-x-1/2">
              <div className="glass-bar flex flex-col items-center gap-5 rounded-2xl px-6 py-5 text-milk sm:flex-row sm:justify-between">
                <nav className="fnote flex gap-5 text-[10.5px]">
                  <Link href="/walk" className="opacity-80 transition-opacity hover:opacity-100">
                    The walk
                  </Link>
                  <Link href="/detect" className="opacity-80 transition-opacity hover:opacity-100">
                    Detector bench
                  </Link>
                </nav>
                <p className="fnote text-center text-[10.5px] text-mist">
                  Waterloo Park · 43.4657° N, 80.5322° W
                  <br />
                  {stats.objects} things remembered · every discard on the record
                </p>
                <Link href="/walk" className="pill-ghost px-4 py-2 text-[13px] text-milk">
                  <Plus size={13} strokeWidth={2} aria-hidden />
                  Get started
                </Link>
              </div>
            </footer>

            <p
              aria-hidden
              className="pointer-events-none mx-auto mt-6 w-fit translate-y-[16%] whitespace-nowrap text-center text-[clamp(9rem,30vw,26rem)] font-semibold leading-[0.78] tracking-[-0.05em] text-ink lg:mt-0"
            >
              spark
              <span className="ml-[0.02em] inline-block h-[0.13em] w-[0.13em] rounded-full bg-clay align-baseline" />
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Act II plates ──────────────────────────────────────────────────────── */

function SieveCard({
  index,
  title,
  count,
  caption,
  accent = false,
  children,
}: {
  index: string;
  title: string;
  count: number;
  caption: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      data-reveal
      className="starfield relative overflow-hidden rounded-[14px] bg-spruce p-6 shadow-[inset_0_0_0_1px_rgb(246_240_223_/_0.14),0_18px_40px_-22px_rgb(27_27_24_/_0.55)]"
    >
      <div className="relative">
        <div className="flex items-baseline justify-between">
          <p className="fnote text-[10.5px] text-mist">[ {index} ]</p>
          <p className="fnote text-[10.5px] text-mist">{title.toUpperCase()}</p>
        </div>
        <div className="mt-5 flex h-36 items-center justify-center">{children}</div>
        <p
          className={`tnum mt-5 text-[clamp(2.6rem,4.4vw,3.6rem)] font-medium leading-none ${accent ? "text-brass" : "text-milk"}`}
        >
          <span data-count={count}>{count.toLocaleString("en-CA")}</span>
        </p>
        <p className="mt-2.5 max-w-[30ch] text-[13px] leading-relaxed text-mist">{caption}</p>
      </div>
    </article>
  );
}

/** [ 001 ] — a camera's field of dots, warm where something was noticed. */
function DotMatrix() {
  const rand = mulberry32(0xdeed);
  const dots = Array.from({ length: 13 * 7 }, (_, i) => {
    const x = i % 13;
    const y = Math.floor(i / 13);
    const dx = x - 6.4;
    const dy = y - 3.2;
    const hot = Math.exp(-(dx * dx + dy * dy) / 9) + rand() * 0.14;
    return { x, y, hot };
  });
  return (
    <svg viewBox="0 0 260 140" className="h-full w-auto" aria-hidden>
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={12 + d.x * 19.5}
          cy={12 + d.y * 19}
          // Two decimals — full-precision floats can serialize differently on
          // the server and the client, which trips hydration.
          r={Math.round((2.1 + d.hot * 2.6) * 100) / 100}
          fill={d.hot > 0.55 ? BRASS : "rgb(246 240 223 / 0.28)"}
        />
      ))}
    </svg>
  );
}

/** [ 002 ] — one bar per real candidate; exactly `kept` clear the line. */
function ScoreBars({ candidates, kept }: { candidates: number; kept: number }) {
  const LINE = 0.62;
  const rand = mulberry32(0xbaa5);
  // Deterministic heights: exactly `kept` bars land above the line, spread
  // evenly through the day, the rest below.
  const aboveIdx = new Set(
    Array.from({ length: kept }, (_, k) => Math.floor((k * candidates) / kept)),
  );
  const bars = Array.from({ length: candidates }, (_, i) => {
    const v = aboveIdx.has(i)
      ? LINE + 0.08 + rand() * 0.28
      : 0.16 + rand() * (LINE - 0.24);
    return Math.round(v * 100) / 100;
  });
  const step = 244 / bars.length;
  return (
    <svg viewBox="0 0 260 140" className="h-full w-auto" aria-hidden>
      {bars.map((v, i) => (
        <rect
          key={i}
          x={Math.round((10 + i * step) * 10) / 10}
          y={126 - v * 104}
          width={Math.min(13, step * 0.62)}
          height={v * 104}
          rx={2.5}
          fill={v >= LINE ? BRASS : "rgb(246 240 223 / 0.26)"}
        />
      ))}
      <line
        x1={6}
        x2={254}
        y1={126 - LINE * 104}
        y2={126 - LINE * 104}
        stroke={CLAY}
        strokeWidth={1.5}
        strokeDasharray="5 5"
      />
    </svg>
  );
}

/** [ 003 ] — six teardrop pins, pressed onto the page. */
function PinRow() {
  const inks = [BRASS, CLAY, MOSS, "#8fb3ad", BRASS, CLAY];
  return (
    <svg viewBox="0 0 260 140" className="h-full w-auto" aria-hidden>
      <path
        d="M14 108 C 60 84, 96 122, 138 96 S 224 66, 248 84"
        fill="none"
        stroke="rgb(246 240 223 / 0.3)"
        strokeWidth={1.6}
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      {inks.map((ink, i) => {
        const x = 24 + i * 42;
        const y = [104, 92, 110, 90, 78, 86][i];
        return (
          <g key={i} transform={`translate(${x} ${y})`}>
            <path
              d="M0 0 C -9 -12, -9 -26, 0 -30 C 9 -26, 9 -12, 0 0 Z"
              fill={ink}
              stroke={PINE}
              strokeWidth={1.2}
            />
            <circle cx={0} cy={-19} r={4.4} fill={PINE} />
          </g>
        );
      })}
    </svg>
  );
}

/** A receipt line — a real number with its story underneath. */
function Receipt({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="tnum text-[clamp(1.7rem,2.6vw,2.3rem)] font-medium leading-none text-ink">{value}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-soft">{label}</p>
    </div>
  );
}

const FIELD_NOTES = [
  {
    q: "WHY KEEP SO LITTLE?",
    a: [
      "A camera roll with nine hundred photos of one evening is a place memories go to be lost. Spark's bet is the opposite: a walk survives as the six minutes you'd actually retell.",
      "Everything else is still on the record — counted, timestamped and auditable — it just doesn't get rebuilt in 3D.",
    ],
  },
  {
    q: "WHAT COUNTS AS SYNTHETIC?",
    a: [
      "Tonight's preview clouds and keyframe stand-ins are generated, and every one of them is labelled on its face. Odometry, detections and the map are measured.",
      "The rule is absolute: nothing synthetic wears a real thing's clothes. Unknown renders as unknown, never as zero.",
    ],
  },
  {
    q: "WHERE'S MY WATER BOTTLE?",
    a: [
      "The robot indexes every distinct thing it sees against the walk's real coordinates. Ask, and it points to the bench where you left the bottle — inside the rebuilt moment, standing where it stood.",
    ],
  },
  {
    q: "WHY SHOW THE DISCARDS?",
    a: [
      "Because a memory machine you can't audit is a stranger editing your life. The bench shows every candidate that fired, its score, and the exact reason it lost.",
      "If the sieve is wrong, you should be able to catch it being wrong.",
    ],
  },
];
