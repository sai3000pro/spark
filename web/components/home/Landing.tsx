"use client";

/**
 * The landing: scroll cinema that tells the product with the product's data.
 *
 * Act I    The keep-log types itself while 900 drifting points of light
 *          converge into the day's REAL route (odometry → constellation).
 * Act II   Key art — the robot on the path at blue hour (generated art).
 * Act III  The six kept moments on a horizontal rail.
 * Act IV   The sieve — detections → candidates → moments, honestly.
 * Act V    Step back inside — what a splat is, in one breath.
 * Act VI   Walk it back — the doors into the app.
 *
 * Motion contract (DESIGN.md): markup defaults are the FINAL state and GSAP
 * animates FROM elsewhere, so no-JS, reduced-motion and ≤1024px all get a
 * complete static page. Desktop + fine-pointer + motion-ok gets Lenis smooth
 * scroll and the scrubbed timelines. Exactly two eases, registered under the
 * same names as the CSS custom properties.
 */
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import Lenis from "lenis";
import { ArrowDown, ArrowRight, MapPin, Music } from "lucide-react";
import keyartA from "@/public/hero/keyart-a.webp";
import keyartB from "@/public/hero/keyart-b.webp";
import robotCutout from "@/public/hero/robot-cutout.webp";
import { Constellation, type ConstellationHandle } from "@/components/home/Constellation";
import { KeyframeImg, NumberChip } from "@/components/system/ui";
import { EMBER, GOLD, MOMENT_INKS, inkForMoment } from "@/lib/theme";

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

export interface LandingProps {
  dateLabel: string;
  placeLabel: string;
  region: string;
  stats: {
    distance: string;
    duration: string;
    detections: string;
    detectionsRaw: number;
    candidates: number;
    moments: number;
    objects: number;
  };
  log: Array<{ clock: string; line: string }>;
  moments: LandingMoment[];
  /** Route polyline in unit space, aspect-preserved. */
  route: Array<[number, number]>;
  /** The six moment positions in the same unit space. */
  pins: Array<[number, number]>;
}

gsap.registerPlugin(ScrollTrigger, CustomEase);

export function Landing({ dateLabel, placeLabel, stats, log, moments, route, pins }: LandingProps) {
  const root = useRef<HTMLDivElement>(null);
  const stars = useRef<ConstellationHandle>(null);

  useEffect(() => {
    // Same beziers as --ease-signature / --ease-reveal in globals.css, so JS
    // motion and CSS motion are literally identical.
    if (!CustomEase.get("signature")) CustomEase.create("signature", "0.785,0.135,0.15,0.86");
    if (!CustomEase.get("reveal")) CustomEase.create("reveal", "0.5,0,0,1");

    const mm = gsap.matchMedia(root);

    // ── Full cinema: desktop, motion allowed ────────────────────────────
    mm.add("(min-width: 1025px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis();
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      // Act I — the intro scrub.
      const convergence = { p: 0 };
      const intro = gsap.timeline({
        scrollTrigger: {
          trigger: "[data-intro]",
          start: "top top",
          end: "bottom bottom",
          scrub: 0.6,
        },
        defaults: { ease: "none" },
      });

      intro
        .from(".log-line", {
          autoAlpha: 0,
          y: 16,
          filter: "blur(4px)",
          stagger: 0.03,
          duration: 0.2,
        })
        .to(".scroll-hint", { autoAlpha: 0, duration: 0.05 }, 0.1)
        .to(
          convergence,
          {
            p: 1,
            duration: 0.34,
            onUpdate: () => stars.current?.setProgress(convergence.p),
          },
          0.28,
        )
        .to(".log-line", { autoAlpha: 0, y: -22, stagger: 0.02, duration: 0.12 }, 0.34)
        .from(
          ".route-glow, .route-core",
          { strokeDashoffset: 1, duration: 0.26, ease: "reveal" },
          0.5,
        )
        .from(
          ".route-pin",
          {
            scale: 0,
            transformOrigin: "center",
            stagger: 0.02,
            duration: 0.1,
            ease: "signature",
          },
          0.68,
        )
        .from(
          ".intro-title",
          { autoAlpha: 0, y: 34, filter: "blur(8px)", duration: 0.2, ease: "reveal" },
          0.66,
        )
        .from(
          ".tag-word",
          { autoAlpha: 0, filter: "blur(7px)", y: 10, stagger: 0.03, duration: 0.12 },
          0.76,
        )
        .from(".intro-stats", { autoAlpha: 0, y: 12, duration: 0.1 }, 0.9);

      // Act II — key art parallax: the painting moves slower than the page.
      gsap.fromTo(
        ".keyart-img",
        { yPercent: -10 },
        {
          yPercent: 10,
          ease: "none",
          scrollTrigger: { trigger: "[data-keyart]", start: "top bottom", end: "bottom top", scrub: 0.5 },
        },
      );

      // Act III — the moments rail rides horizontally while the section pins.
      const rail = root.current?.querySelector<HTMLElement>(".rail-track");
      if (rail) {
        gsap.to(rail, {
          x: () => -(rail.scrollWidth - rail.clientWidth + 48),
          ease: "none",
          scrollTrigger: {
            trigger: "[data-rail]",
            start: "top top",
            end: "bottom bottom",
            scrub: 0.6,
            invalidateOnRefresh: true,
          },
        });
      }

      return () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    });

    // ── Everyone: converged constellation + one-shot reveals + count-ups ──
    mm.add("(max-width: 1024px), (prefers-reduced-motion: reduce)", () => {
      stars.current?.setProgress(1);
    });

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let io: IntersectionObserver | undefined;
    if (!reduced) {
      document.documentElement.classList.add("reveal-armed");
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.state = "in";
            io?.unobserve(e.target);
          }
        },
        { threshold: 0.2 },
      );
      root.current?.querySelectorAll("[data-reveal]").forEach((el) => io?.observe(el));
    }

    // Count-ups fire once, from zero to the real number already in the markup.
    const counters = root.current?.querySelectorAll<HTMLElement>("[data-count]") ?? [];
    const counterTriggers: ScrollTrigger[] = [];
    if (!reduced) {
      counters.forEach((el) => {
        const target = Number(el.dataset.count);
        const proxy = { v: target };
        counterTriggers.push(
          ScrollTrigger.create({
            trigger: el,
            start: "top 85%",
            once: true,
            onEnter: () => {
              proxy.v = 0;
              gsap.to(proxy, {
                v: target,
                duration: 1.4,
                ease: "reveal",
                onUpdate: () => {
                  el.textContent = Math.round(proxy.v).toLocaleString("en-CA");
                },
              });
            },
          }),
        );
      });
    }

    return () => {
      mm.revert();
      io?.disconnect();
      counterTriggers.forEach((t) => t.kill());
      document.documentElement.classList.remove("reveal-armed");
    };
  }, []);

  const reducedFallback =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  return (
    <div ref={root} className="relative bg-night text-starlight">
      {/* ── Fixed chrome ─────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 sm:px-8"
        style={{
          background: "linear-gradient(180deg, rgb(15 13 35 / 0.9) 0%, rgb(15 13 35 / 0.55) 55%, rgb(15 13 35 / 0) 100%)",
        }}
      >
        <Link href="/" className="flex items-center gap-2.5" aria-label="Spark home">
          <SparkGlyph />
          <span className="font-display text-[19px] font-extrabold tracking-tight" style={{ fontVariationSettings: '"wdth" 125' }}>
            SPARK
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          {/* .btn-ghost sets display, so `hidden` must live on a wrapper. */}
          <span className="hidden sm:block">
            <Link href="/detect" className="btn-ghost px-4 py-2 text-[13px]">
              Detector bench
            </Link>
          </span>
          <Link href="/walk" className="btn-ember px-4 py-2 text-[13px]">
            Step into the walk
            <ArrowRight size={15} strokeWidth={1.5} aria-hidden />
          </Link>
        </nav>
      </header>

      {/* ── Act I — the constellation intro ─────────────────────────────── */}
      <section data-intro className="relative lg:h-[320vh]" aria-label="Introduction">
        <div className="starfield relative top-0 flex h-svh flex-col overflow-hidden lg:sticky">
          {/* Nebula: the afterglow low on the horizon. Skies are content here. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `radial-gradient(58% 34% at 50% 106%, rgb(255 142 94 / 0.16) 0%, rgb(255 142 94 / 0) 70%),
                radial-gradient(42% 30% at 82% 8%, rgb(157 139 250 / 0.1) 0%, rgb(157 139 250 / 0) 75%),
                radial-gradient(36% 26% at 12% 14%, rgb(62 230 192 / 0.07) 0%, rgb(62 230 192 / 0) 75%)`,
            }}
          />

          {reducedFallback ? null : (
            <Constellation ref={stars} route={route} className="absolute inset-0 h-full w-full" />
          )}

          {/* The route, drawn from real odometry. Hidden until the draw on
              desktop; the finished state for everyone else. */}
          {/* Geometry contract: the constellation fits the route into a
              min(w,h)·0.64 centered box (18% padding); this SVG must occupy
              the SAME box or the points converge beside the drawn line. On
              mobile the converged points alone carry the shape. */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 m-auto hidden h-[64%] w-auto max-w-[80%] lg:block"
            aria-hidden
          >
            <path
              d={toPath(route)}
              className="route-glow"
              pathLength={1}
              strokeDasharray={1}
              fill="none"
              stroke={EMBER}
              strokeWidth={1.9}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.28}
              style={{ filter: "blur(2.2px)" }}
            />
            <path
              d={toPath(route)}
              className="route-core"
              pathLength={1}
              strokeDasharray={1}
              fill="none"
              stroke={GOLD}
              strokeWidth={0.55}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {pins.map(([x, y], i) => (
              <circle
                key={i}
                className="route-pin"
                cx={x * 100}
                cy={y * 100}
                r={1.5}
                fill={MOMENT_INKS[i % MOMENT_INKS.length].base}
                stroke="#0f0d23"
                strokeWidth={0.4}
              />
            ))}
          </svg>

          {/* The robot's keep-log, typing itself down the left. */}
          <div className="absolute left-5 top-24 flex flex-col gap-2.5 sm:left-10" aria-hidden>
            {log.map((l, i) => (
              <p
                key={i}
                className="log-line tag max-w-[90vw] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-moth sm:text-[11px]"
              >
                <span className="text-faint">[ {l.clock} ]</span>{" "}
                <span className={l.line.startsWith("KEEP") ? "text-gold" : undefined}>{l.line}</span>
              </p>
            ))}
          </div>

          {/* Title block — the intro's destination. */}
          <div className="intro-title relative z-10 mt-auto px-5 pb-16 sm:px-10 sm:pb-20">
            <h1
              className="font-display text-[11.5vw] leading-[0.92] tracking-[-0.02em] sm:text-[96px]"
              style={{ fontVariationSettings: '"wdth" 125', fontWeight: 900 }}
            >
              A day, remembered
              <br />
              <span className="text-gold">in light.</span>
            </h1>
            <p className="mt-5 max-w-[52ch] text-[15px] leading-relaxed text-moth sm:text-[17px]">
              {"Spark walks behind you, decides what mattered on its own, and rebuilds those moments as clouds of captured light you can step back into.".split(" ").map((w, i) => (
                <span key={i} className="tag-word inline-block">
                  {w}&nbsp;
                </span>
              ))}
            </p>
            <p className="intro-stats tag mt-6 text-[11px] text-faint">
              [ {dateLabel.toUpperCase()} · {placeLabel.toUpperCase()} · {stats.distance.toUpperCase()} ·{" "}
              {stats.duration.toUpperCase()} · {stats.moments} KEPT ]
            </p>
          </div>

          <div className="scroll-hint pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 items-center gap-2 lg:flex" aria-hidden>
            <ArrowDown size={14} strokeWidth={1.5} className="text-faint" />
            <span className="tag text-[10px] text-faint">scroll — the night remembers</span>
          </div>
        </div>
      </section>

      {/* ── Act II — key art ─────────────────────────────────────────────── */}
      <section data-keyart className="relative overflow-hidden" aria-label="The robot on the walk">
        <div className="relative h-svh min-h-[520px]">
          <Image
            src={keyartA}
            alt="Illustration: the Spark robot rolling along a park path at blue hour, aurora over a dark lake"
            fill
            sizes="100vw"
            placeholder="empty"
            className="keyart-img object-cover"
            style={{ scale: "1.12" }}
            priority={false}
          />
          {/* Bind the painting to the page ground at both edges. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0f0d23 0%, rgb(15 13 35 / 0) 18%, rgb(15 13 35 / 0) 72%, #0f0d23 100%)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-14 sm:px-10">
            <h2 data-reveal className="font-display max-w-[16ch] text-4xl sm:text-[76px] sm:leading-[0.95]">
              It walked with you.
            </h2>
            <p data-reveal className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-moth sm:text-[16px]">
              {dateLabel}, {placeLabel}. A metre and a half behind, never in the way — watching,
              listening, deciding for itself which minutes were worth keeping.
            </p>
            <p data-reveal className="tag mt-5 text-[10px] text-faint">
              [ FOLLOW MODE · 1.4 M BEHIND · {stats.distance.toUpperCase()} WALKED ]
            </p>
          </div>
        </div>
      </section>

      {/* ── Act III — the six kept moments ──────────────────────────────── */}
      <section data-rail className="relative lg:h-[280vh]" aria-label="The kept moments">
        <div className="top-0 flex h-auto flex-col justify-center overflow-hidden py-16 lg:sticky lg:h-svh lg:py-0">
          <div className="px-5 sm:px-10">
            <p data-reveal className="tag text-[11px] text-faint">
              [ {stats.moments.toString().padStart(2, "0")} KEPT · CHOSEN BY THE MACHINE ]
            </p>
            <h2 data-reveal className="font-display mt-3 text-4xl sm:text-[76px] sm:leading-[0.95]">
              It kept six.
            </h2>
            <p data-reveal className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-moth">
              Not every minute — six. Each one triggered by something it saw or heard, scored,
              and rebuilt in 3D. Click one to step inside it.
            </p>
          </div>

          <div className="rail-track mt-10 flex gap-5 overflow-x-auto px-5 pb-4 scrollbar-thin sm:px-10 lg:mt-14 lg:overflow-visible lg:pb-0">
            {moments.map((m, i) => {
              const ink = inkForMoment(i);
              return (
                <Link
                  key={m.id}
                  href={`/walk?m=${m.id}`}
                  className="group relative w-[78vw] shrink-0 sm:w-[420px]"
                  style={{ transition: "transform 0.3s var(--ease-signature)" }}
                >
                  <article className="plate overflow-hidden">
                    <div className="relative">
                      <KeyframeImg
                        keyframe={{ placeholderSeed: m.seed, hue: m.hue, url: m.url }}
                        alt={`Keyframe stand-in for “${m.title}”`}
                        width={840}
                        height={520}
                        className="aspect-[8/5] w-full object-cover"
                      />
                      {/* The moment's ink rises from the frame's floor. */}
                      <div
                        aria-hidden
                        className="absolute inset-0"
                        style={{
                          background: `linear-gradient(180deg, rgb(15 13 35 / 0) 55%, ${ink.glow} 100%)`,
                        }}
                      />
                      <span className="absolute left-3 top-3">
                        <NumberChip n={i + 1} ink={ink} size="md" />
                      </span>
                      {m.hasMusic && (
                        <span className="chip tag absolute right-3 top-3 bg-night/70 text-[9px]">
                          <Music size={11} strokeWidth={1.5} aria-hidden /> scored
                        </span>
                      )}
                    </div>
                    <div className="p-5">
                      <p className="tag text-[10px] text-faint">
                        [ {m.clock} · {m.length.toUpperCase()} · {m.place.toUpperCase()} ]
                      </p>
                      <h3 className="mt-2 text-[22px] leading-tight">{m.title}</h3>
                      <p className="mt-2 line-clamp-2 text-[13.5px] leading-relaxed text-moth">
                        {m.summary}
                      </p>
                      <p
                        className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold"
                        style={{ color: ink.base }}
                      >
                        Step inside
                        <ArrowRight
                          size={14}
                          strokeWidth={1.5}
                          className="transition-transform duration-300 group-hover:translate-x-1"
                          style={{ transitionTimingFunction: "var(--ease-signature)" }}
                          aria-hidden
                        />
                      </p>
                    </div>
                  </article>
                </Link>
              );
            })}
            {/* Rail end-cap: the door to the map. */}
            <Link
              href="/walk"
              className="plate flex w-[60vw] shrink-0 flex-col items-start justify-center gap-4 p-8 sm:w-[340px]"
            >
              <MapPin size={22} strokeWidth={1.5} className="text-ember" aria-hidden />
              <span className="font-display text-[26px] leading-tight">
                All six, pinned on the real park
              </span>
              <span className="btn-ember px-4 py-2 text-[13px]">
                Open the map
                <ArrowRight size={14} strokeWidth={1.5} aria-hidden />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Act IV — the sieve ──────────────────────────────────────────── */}
      <section className="starfield relative bg-dusk py-24 sm:py-36" aria-label="How Spark decides">
        <div className="relative mx-auto max-w-5xl px-5 sm:px-10">
          <p data-reveal className="tag text-[11px] text-faint">
            [ THE SIEVE · EVERY DECISION AUDITABLE ]
          </p>
          <h2 data-reveal className="font-display mt-3 text-4xl sm:text-[76px] sm:leading-[0.95]">
            Honest by design.
          </h2>
          <p data-reveal className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-moth">
            A memory you can audit: everything the robot saw, everything it almost kept, and the
            reasons it kept what it kept. Nothing synthetic wears a real thing&apos;s clothes.
          </p>

          <div data-reveal className="mt-14 grid gap-10 sm:grid-cols-3">
            <SieveStep
              label="SEEN"
              count={stats.detectionsRaw}
              caption="raw detections — every duck, bench and backpack the cameras noticed"
              tone="text-moth"
            />
            <SieveStep
              label="WEIGHED"
              count={stats.candidates}
              caption="candidate windows scored on dwell, laughter, novelty and named things"
              tone="text-aurora"
            />
            <SieveStep
              label="KEPT"
              count={stats.moments}
              caption="moments rebuilt in 3D, scored to music, pinned to the park"
              tone="text-gold"
            />
          </div>

          <div data-reveal className="mt-14 flex flex-wrap items-center gap-3">
            <span className="chip chip-live tag text-[10px]">[ MEASURED ]</span>
            <span className="text-[13.5px] text-moth">ran through the real pipeline —</span>
            <span className="chip chip-synth tag text-[10px]">[ SYNTHETIC ]</span>
            <span className="text-[13.5px] text-moth">
              says so on its face. The discarded candidates stay visible on the bench.
            </span>
          </div>

          <Link data-reveal href="/detect" className="btn-ghost mt-10 inline-flex px-5 py-2.5 text-[14px]">
            Open the detector bench
            <ArrowRight size={15} strokeWidth={1.5} aria-hidden />
          </Link>
        </div>
      </section>

      {/* ── Act V — splats ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 sm:py-36" aria-label="What a splat is">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-10 lg:grid-cols-2">
          <div>
            <p data-reveal className="tag text-[11px] text-faint">
              [ GAUSSIAN SPLATTING · 3D FROM WALKING PAST ]
            </p>
            <h2 data-reveal className="font-display mt-3 text-4xl sm:text-[64px] sm:leading-[0.95]">
              A memory is a cloud of light.
            </h2>
            <p data-reveal className="mt-5 max-w-[50ch] text-[15px] leading-relaxed text-moth">
              While it follows, Spark films each kept moment from a dozen angles and rebuilds it
              as a Gaussian splat — millions of tiny lights hanging in space. Not a photo of the
              moment: the moment, still standing there. Walk around it. Find the water bottle you
              left on the bench.
            </p>
            <div data-reveal className="mt-8 flex flex-wrap gap-3">
              <Link href="/walk?m=m1" className="btn-ember px-5 py-2.5 text-[14px]">
                Step inside moment 01
                <ArrowRight size={15} strokeWidth={1.5} aria-hidden />
              </Link>
              <span className="chip chip-synth tag self-center text-[10px]">
                [ PREVIEW CLOUDS TONIGHT — REAL CAPTURES DROP IN ]
              </span>
            </div>
          </div>
          <figure data-reveal className="relative">
            <div className="plate overflow-hidden">
              <Image
                src={keyartB}
                alt="Illustration: the robot pausing on the path as the last light fades behind the treeline"
                className="w-full"
                sizes="(min-width: 1024px) 44vw, 92vw"
                placeholder="empty"
              />
            </div>
            <figcaption className="tag mt-3 text-[10px] text-faint">
              [ KEY ART · GENERATED FOR SPARK · Z-IMAGE ]
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── Act VI — closer ─────────────────────────────────────────────── */}
      <section className="starfield relative overflow-hidden pb-16 pt-24 sm:pt-32" aria-label="Enter the app">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(52% 42% at 50% 100%, rgb(255 142 94 / 0.14) 0%, rgb(255 142 94 / 0) 72%)",
          }}
        />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 text-center">
          <Image
            data-reveal
            src={robotCutout}
            alt="The Spark robot, sitting with two fireflies"
            className="w-56 sm:w-72"
            sizes="288px"
            placeholder="empty"
          />
          <h2 data-reveal className="font-display mt-6 text-5xl sm:text-[88px] sm:leading-[0.92]">
            Walk it back.
          </h2>
          <p data-reveal className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-moth">
            The whole day is pinned to the real park, one glowing marker per kept moment. The
            robot remembers where everything is — ask it.
          </p>
          <div data-reveal className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/walk" className="btn-ember px-6 py-3 text-[15px]">
              Step into the walk
              <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
            </Link>
            <Link href="/detect" className="btn-ghost px-5 py-3 text-[14px]">
              Detector bench
            </Link>
          </div>
          <p className="tag mt-20 text-[10px] text-faint">
            [ SPARK · WATERLOO PARK · 43.4657° N · 80.5322° W · {stats.objects} THINGS REMEMBERED ]
          </p>
        </div>
      </section>
    </div>
  );
}

function SieveStep({
  label,
  count,
  caption,
  tone,
}: {
  label: string;
  count: number;
  caption: string;
  tone: string;
}) {
  return (
    <div>
      <p className="tag text-[10px] text-faint">[ {label} ]</p>
      <p
        className={`tnum font-display mt-2 text-[56px] leading-none ${tone}`}
        style={{ fontVariationSettings: '"wdth" 125', fontWeight: 800 }}
      >
        <span data-count={count}>{count.toLocaleString("en-CA")}</span>
      </p>
      <p className="mt-3 max-w-[30ch] text-[13px] leading-relaxed text-moth">{caption}</p>
    </div>
  );
}

function toPath(points: Array<[number, number]>): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`)
    .join("");
}

/** The brand glyph: a four-point spark, now a light. */
function SparkGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 1.5 L14 9.5 L22.5 12 L14 14.5 L12 22.5 L10 14.5 L1.5 12 L10 9.5 Z"
        fill={EMBER}
      />
      <circle cx="12" cy="12" r="2.4" fill={GOLD} />
    </svg>
  );
}
