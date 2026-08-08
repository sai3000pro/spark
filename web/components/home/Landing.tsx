"use client";

/**
 * The landing: the robot's field journal, told as scroll cinema.
 *
 * I    Hero — deep-pine ground, halftone dots, the promise with a
 *      blur-cycling last line, and the kept moments lapping under it.
 * II   The sieve — one pinned typeset scene on paper: everything the robot
 *      noticed, set as words on the page; scrolling crosses them out in ink,
 *      one by one, until six circled entries remain. "It kept six."
 * III  How it decides — the smeared marquee band, then Seen / Weighed / Kept
 *      as three dark plates whose instruments draw themselves: a wave of
 *      detections, score bars growing against the keep-line, pins walking
 *      onto the route — with the real numbers counting up.
 * IV   Six moments, kept — a horizontal gallery pinned to the scroll; each
 *      vellum card wears its moment's ink, with the evening's rail beneath.
 * V    The crossed-out pages — every discarded candidate, its trigger, score
 *      and the exact reason it lost. Honesty as a section, not a footnote.
 * VI   A giant statement dragged across the page by the scroll.
 * VII  The field notes — an accordion of the questions people actually ask.
 * VIII Finale — pine again, the giant wordmark behind one pane of glass.
 *
 * Motion contract (DESIGN.md v5.1): markup defaults are the FINAL state and
 * JS animates FROM elsewhere — no-JS and reduced-motion get a complete page
 * (the sieve rests on "It kept six", the gallery scrolls natively). Lenis and
 * the pinned gallery are desktop-only; exactly two eases, registered under
 * the same names as the CSS custom properties. "Night air" is an opt-in
 * ambient sound layer, synthesized on device.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import Lenis from "lenis";
import { ArrowDown, ArrowUpRight, Music, Plus, RotateCw, Volume2, VolumeX } from "lucide-react";
import { KeyframeImg } from "@/components/system/ui";
import { BRASS, CLAY, PINE } from "@/lib/theme";

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

/* Deterministic PRNG — generated layouts must agree between the server and
   client renders. */
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

const HERO_CYCLE = ["in light.", "in place.", "in sound."];

/* Where a moment's ink lands on paper — the journal's own pressed cycle. */
const PAPER_INKS = ["#8a6d2f", "#476d73", "#c14f24", "#2c4347", "#7d7730", "#1b1b18"];

/* ── Night air — an opt-in ambient layer, synthesized on device ─────────── */

function useNightAir() {
  const [on, setOn] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const cricketTimer = useRef(0);

  const stop = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    window.clearTimeout(cricketTimer.current);
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      window.setTimeout(() => void ctx.close().catch(() => {}), 1100);
    }
    ctxRef.current = null;
    masterRef.current = null;
  }, []);

  const start = useCallback(() => {
    if (ctxRef.current || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.setTargetAtTime(0.75, ctx.currentTime + 0.05, 0.6);
    masterRef.current = master;

    // Wind: looped brown noise breathing through a slowly wandering lowpass.
    const rate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, 4 * rate, rate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    lp.Q.value = 0.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.17;
    src.connect(lp).connect(windGain).connect(master);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 105;
    lfo.connect(lfoGain).connect(lp.frequency);
    src.start();
    lfo.start();

    // Crickets: sparse three-pulse chirps, far away and very quiet.
    const chirp = () => {
      const t0 = ctx.currentTime + 0.02;
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 4150 + Math.random() * 280;
        const g = ctx.createGain();
        const t = t0 + i * 0.085;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.016, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
        osc.connect(g).connect(master);
        osc.start(t);
        osc.stop(t + 0.1);
      }
      cricketTimer.current = window.setTimeout(chirp, 1900 + Math.random() * 3600);
    };
    cricketTimer.current = window.setTimeout(chirp, 1300);
  }, []);

  const toggle = useCallback(() => {
    if (on) stop();
    else start();
    setOn(!on);
  }, [on, start, stop]);

  useEffect(() => () => stop(), [stop]);
  return { on, toggle };
}

/* ═════════════════════════════════ page ════════════════════════════════ */

export function Landing({ dateLabel, placeLabel, stats, noticed, moments, discards }: LandingProps) {
  const root = useRef<HTMLDivElement>(null);
  const heroWord = useRef<HTMLSpanElement>(null);
  const [note, setNote] = useState(0);
  const air = useNightAir();

  // The day, typeset — the noticed words set as one block of text. Six of
  // them, spread through the block, are the keepers: each wears its moment's
  // pressed ink and clock. Deterministic, so server and client agree.
  const wall = useMemo(() => {
    const rand = mulberry32(0x40bd5);
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const words = noticed.slice(0, 48);
    const keptAt = new Map<number, number>();
    const stride = words.length / (moments.length + 0.5);
    moments.forEach((_, m) => {
      let idx = Math.min(words.length - 1, Math.round(stride * (m + 0.7) + rand() * 3) - 1);
      while (keptAt.has(idx)) idx = (idx + 1) % words.length;
      keptAt.set(idx, m);
    });
    return words.map((word, i) => ({
      word,
      kept: keptAt.get(i),
      tilt: r3((rand() - 0.5) * 9),
      order: r3(rand()),
    }));
  }, [noticed, moments]);

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

      const killers: Array<() => void> = [];

      // The sieve. Captions and the crossing-out are children of one pinned,
      // scrubbed timeline. Markup defaults are the FINAL state (words struck,
      // six circled), so time 0 explicitly rewinds every player first.
      const chaff = Array.from(el.querySelectorAll<HTMLElement>("[data-chaff]"));
      const sieve = gsap
        .timeline({
          scrollTrigger: {
            trigger: "[data-sieve]",
            start: "top top",
            end: "+=260%",
            scrub: 0.5,
            pin: true,
            anticipatePin: 1,
          },
        })
        .set("[data-sieve-b]", { autoAlpha: 0 }, 0)
        .set("[data-sieve-c]", { autoAlpha: 0 }, 0)
        .set("[data-sieve-a]", { autoAlpha: 1 }, 0)
        .set(chaff, { opacity: 1 }, 0)
        .set("[data-strike]", { scaleX: 0 }, 0)
        .set("[data-kept-clock]", { autoAlpha: 0, y: 6 }, 0)
        .set("[data-circle-path]", { strokeDashoffset: 103 }, 0)
        .to("[data-sieve-hint]", { autoAlpha: 0, duration: 0.2 }, 0.25)
        .to("[data-sieve-a]", { autoAlpha: 0, duration: 0.35, ease: "signature" }, 0.9)
        .to("[data-sieve-b]", { autoAlpha: 1, duration: 0.35, ease: "signature" }, 1.3)
        .to("[data-sieve-b]", { autoAlpha: 0, duration: 0.35, ease: "signature" }, 2.0)
        .to("[data-sieve-c]", { autoAlpha: 1, duration: 0.45, ease: "signature" }, 2.35)
        .to(
          "[data-circle-path]",
          { strokeDashoffset: 0, duration: 0.5, ease: "signature", stagger: 0.09 },
          2.3,
        )
        .to(
          "[data-kept-clock]",
          { autoAlpha: 1, y: 0, duration: 0.35, ease: "reveal", stagger: 0.09 },
          2.5,
        )
        .to({}, { duration: 0.4 });
      // Every word is crossed out on its own beat, in a shuffled order — the
      // pen working down the page while the captions change overhead.
      chaff.forEach((node) => {
        const at = 1.0 + Number(node.dataset.order ?? 0) * 1.1;
        const strike = node.querySelector("[data-strike]");
        if (strike) sieve.to(strike, { scaleX: 1, duration: 0.14, ease: "none" }, at);
        sieve.to(node, { opacity: 0.3, duration: 0.3, ease: "none" }, at + 0.04);
      });
      killers.push(() => {
        sieve.scrollTrigger?.kill();
        sieve.kill();
      });

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
      killers.push(() => window.clearInterval(cycleIv));

      // The three plates draw their instruments when they arrive.
      el.querySelectorAll<HTMLElement>("[data-plate]").forEach((plate) => {
        const kind = plate.dataset.plate;
        const tl = gsap.timeline({
          scrollTrigger: { trigger: plate, start: "top 80%", once: true },
          defaults: { ease: "reveal" },
        });
        if (kind === "seen") {
          tl.from(plate.querySelectorAll(".dm-dot"), {
            attr: { r: 0 },
            opacity: 0,
            duration: 0.7,
            stagger: { each: 0.014, grid: [7, 13], from: "center" },
          });
          const twinkle = gsap.to(plate.querySelectorAll(".dm-hot"), {
            opacity: 0.45,
            duration: 1.6,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            stagger: { each: 0.28, from: "random" },
          });
          killers.push(() => twinkle.kill());
        } else if (kind === "weighed") {
          tl.from(plate.querySelectorAll(".sb-bar"), {
            scaleY: 0,
            transformOrigin: "50% 100%",
            duration: 0.55,
            stagger: 0.035,
          })
            .from(plate.querySelector(".sb-line"), { scaleX: 0, transformOrigin: "0% 50%", duration: 0.6 }, "-=0.3")
            .fromTo(
              plate.querySelectorAll(".sb-kept"),
              { fill: "rgb(243 239 251 / 0.26)" },
              { fill: BRASS, duration: 0.45, stagger: 0.07 },
              "-=0.15",
            );
        } else if (kind === "kept") {
          const path = plate.querySelector<SVGPathElement>(".pr-path");
          if (path) {
            const len = path.getTotalLength();
            tl.fromTo(path, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.3, ease: "signature" });
          }
          tl.from(
            plate.querySelectorAll(".pr-pin"),
            { y: -26, opacity: 0, scale: 0.5, transformOrigin: "50% 100%", duration: 0.6, stagger: 0.09 },
            "-=0.9",
          );
        }
        killers.push(() => {
          tl.scrollTrigger?.kill();
          tl.kill();
        });
      });

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
      killers.push(() => {
        drag.scrollTrigger?.kill();
        drag.kill();
      });

      // Discard score bars grow when the ledger arrives.
      const ledger = el.querySelector("[data-ledger]");
      if (ledger) {
        const lt = gsap.from(ledger.querySelectorAll<HTMLElement>("[data-score-bar]"), {
          scaleX: 0,
          transformOrigin: "0% 50%",
          duration: 0.9,
          ease: "reveal",
          stagger: 0.08,
          scrollTrigger: { trigger: ledger, start: "top 78%", once: true },
        });
        killers.push(() => {
          lt.scrollTrigger?.kill();
          lt.kill();
        });
      }

      // One-shot reveals.
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            (e.target as HTMLElement).dataset.state = "in";
            io.unobserve(e.target);
          }
        },
        { threshold: 0.18 },
      );
      el.querySelectorAll("[data-reveal]").forEach((n) => io.observe(n));
      killers.push(() => io.disconnect());

      // Count-ups fire once, to the real number already in the markup.
      el.querySelectorAll<HTMLElement>("[data-count]").forEach((n) => {
        const target = Number(n.dataset.count);
        const proxy = { v: target };
        const st = ScrollTrigger.create({
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
        });
        killers.push(() => st.kill());
      });

      return () => {
        killers.forEach((k) => k());
        document.documentElement.classList.remove("reveal-armed");
      };
    });

    // ── The gallery: pinned horizontal on desktop, native scroll below ──
    mm.add("(min-width: 1025px) and (prefers-reduced-motion: no-preference)", () => {
      const el = root.current!;
      const viewport = el.querySelector<HTMLElement>("[data-gallery-viewport]");
      const track = el.querySelector<HTMLElement>("[data-gallery-track]");
      const fill = el.querySelector<HTMLElement>("[data-rail-fill]");
      const dots = Array.from(el.querySelectorAll<HTMLElement>("[data-rail-dot]"));
      if (!viewport || !track) return;
      viewport.style.overflowX = "hidden";
      const dist = () => Math.max(0, track.scrollWidth - viewport.clientWidth);
      if (fill) fill.style.transform = "scaleX(0)";
      const tween = gsap.to(track, {
        x: () => -dist(),
        ease: "none",
        scrollTrigger: {
          trigger: "[data-gallery]",
          start: "top top",
          end: () => "+=" + Math.round(dist() + window.innerHeight * 0.35),
          pin: true,
          scrub: 0.5,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (st) => {
            if (fill) fill.style.transform = `scaleX(${st.progress})`;
            const idx = st.progress * (dots.length - 1) + 1e-3;
            dots.forEach((d, i) => {
              d.style.opacity = i <= idx ? "1" : "0.3";
              d.style.transform = i <= idx ? "scale(1.3)" : "scale(1)";
            });
          },
        },
      });
      return () => {
        tween.scrollTrigger?.kill();
        tween.kill();
        viewport.style.overflowX = "";
        if (fill) fill.style.transform = "";
        dots.forEach((d) => {
          d.style.opacity = "";
          d.style.transform = "";
        });
        gsap.set(track, { clearProps: "x" });
      };
    });

    return () => {
      mm.revert();
    };
  }, []);

  const noticedFmt = stats.detectionsRaw.toLocaleString("en-CA");
  const maxScore = Math.max(...discards.map((d) => d.score), 1);

  return (
    <div ref={root} className="field-site relative bg-paper text-ink">
      <header className="glass-bar sticky top-0 z-40 flex items-center justify-between px-5 py-3 text-milk sm:px-8">
        <Link href="/" className="flex items-baseline gap-0.5 text-[20px] font-semibold tracking-tight" aria-label="Spark home">
          spark
          <span aria-hidden className="inline-block h-[7px] w-[7px] rounded-full bg-clay" />
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          <Link href="/walk" className="hidden text-[13.5px] text-milk/85 transition-opacity hover:text-milk sm:block">
            The walk
          </Link>
          <Link href="/detect" className="hidden text-[13.5px] text-milk/85 transition-opacity hover:text-milk sm:block">
            Detector bench
          </Link>
          <button
            onClick={air.toggle}
            aria-pressed={air.on}
            title={air.on ? "Night air on — wind and crickets" : "Night air — an ambient sound layer"}
            className="grid h-8 w-8 place-items-center rounded-full text-milk/85 shadow-[inset_0_0_0_1px_rgb(243_239_251_/_0.3)] transition-colors hover:text-milk"
          >
            {air.on ? (
              <Volume2 size={14} strokeWidth={1.75} aria-hidden className="text-brass" />
            ) : (
              <VolumeX size={14} strokeWidth={1.75} aria-hidden />
            )}
            <span className="sr-only">{air.on ? "Turn night air off" : "Turn night air on"}</span>
          </button>
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
            style={{ "--reveal-delay": "80ms" } as React.CSSProperties}
            className="mt-6 text-[clamp(2.9rem,7vw,6rem)] leading-[1.02] text-milk"
          >
            A day, remembered
            <br />
            <span ref={heroWord} className="inline-block text-brass" style={{ willChange: "filter, opacity" }}>
              {HERO_CYCLE[0]}
            </span>
          </h1>
          <p
            data-reveal
            style={{ "--reveal-delay": "160ms" } as React.CSSProperties}
            className="mt-7 max-w-[52ch] text-[15.5px] leading-relaxed text-mist sm:text-[17px]"
          >
            Spark follows a metre behind your walk, decides on its own which minutes
            mattered, and rebuilds them as clouds of light pinned to the real park.
          </p>
          <div
            data-reveal
            style={{ "--reveal-delay": "240ms" } as React.CSSProperties}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
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
            WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
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

      {/* ── II · the sieve ─────────────────────────────────────────────── */}
      <section
        data-sieve
        className="papergrain relative flex h-svh min-h-[620px] flex-col overflow-hidden bg-paper"
        aria-label="Everything the robot noticed, crossed out down to what it kept"
      >
        {/* Captions. C is the markup default — the no-JS and reduced-motion
            resting state; A and B are staged in by the timeline. */}
        <div className="pointer-events-none absolute inset-x-0 top-[11%] z-10 px-6 text-center">
          <div data-sieve-a className="opacity-0">
            <h2 className="text-[clamp(2rem,4.4vw,3.4rem)] leading-tight text-ink">
              It noticed <span className="text-brass-deep">{noticedFmt}</span> things.
            </h2>
            <p className="fnote mt-4 text-[11px] text-ink-faint">
              [ every duck, bench, backpack and laugh · {stats.duration} · {stats.distance} ]
            </p>
          </div>
          <div data-sieve-b className="absolute inset-x-0 top-0 px-6 opacity-0">
            <h2 className="text-[clamp(2rem,4.4vw,3.4rem)] leading-tight text-ink">
              It weighed <span className="text-brass-deep">{stats.candidates}</span> of its minutes.
            </h2>
            <p className="fnote mt-4 text-[11px] text-ink-faint">[ dwell · laughter · novelty · named things ]</p>
          </div>
          <div data-sieve-c className="absolute inset-x-0 top-0 px-6">
            <h2 className="text-[clamp(2rem,4.4vw,3.4rem)] leading-tight text-ink">
              It kept <span className="text-clay">six</span>.
            </h2>
            <p className="fnote mt-4 text-[11px] text-ink-faint">
              [ each one rebuilt in light · pinned to the real park ]
            </p>
          </div>
        </div>

        {/* The page itself: the noticed words as one typeset block. Default =
            final state — most words struck through, six circled in their
            moment's ink with its clock above. The timeline rewinds all of it
            and plays the pen forward as you scroll. */}
        <div className="relative z-0 mx-auto flex w-full max-w-4xl flex-1 flex-wrap content-center items-baseline justify-center gap-x-4 gap-y-2.5 px-6 pb-[12vh] pt-[30vh] sm:gap-x-5 sm:gap-y-3">
          {wall.map((w, i) =>
            w.kept == null ? (
              <span
                key={`${w.word}-${i}`}
                data-chaff
                data-order={w.order}
                className="relative text-[clamp(0.95rem,1.45vw,1.2rem)] leading-snug text-ink-soft opacity-30"
              >
                {w.word}
                <i
                  aria-hidden
                  data-strike
                  className="absolute -left-[3%] top-[54%] block h-[1.5px] w-[106%] origin-left rounded-full bg-ink/80"
                  style={{ transform: `rotate(${w.tilt}deg)` }}
                />
              </span>
            ) : (
              <span
                key={`${w.word}-${i}`}
                className="relative px-2 py-0.5 text-[clamp(1.05rem,1.6vw,1.3rem)] font-medium leading-snug"
                style={{ color: PAPER_INKS[w.kept % PAPER_INKS.length] }}
              >
                <span
                  data-kept-clock
                  className="fnote absolute -top-3.5 left-1/2 w-max -translate-x-1/2 text-[9px] tracking-[0.14em]"
                >
                  {moments[w.kept]?.clock}
                </span>
                {w.word}
                <svg
                  aria-hidden
                  viewBox="0 0 120 44"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute -left-1.5 -top-1 h-[calc(100%+8px)] w-[calc(100%+12px)] overflow-visible"
                >
                  <path
                    data-circle-path
                    pathLength={100}
                    d="M8 24 C 8 9, 38 3, 62 4 C 92 5, 114 11, 113 22 C 112 35, 84 41, 56 40 C 28 39, 9 34, 8 25"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.6}
                    strokeDasharray={103}
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            ),
          )}
        </div>

        <p
          data-sieve-hint
          className="fnote absolute inset-x-0 bottom-8 z-10 flex flex-col items-center gap-2 text-center text-[11px] text-ink-faint"
        >
          Scroll — the sieve runs
          <ArrowDown size={12} strokeWidth={1.75} aria-hidden />
        </p>
      </section>

      {/* ── III · how it decides ───────────────────────────────────────── */}
      <section
        id="decides"
        className="papergrain relative overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, var(--color-pine) 0%, #2c4347 16%, #a9a893 38%, var(--color-paper) 58%)",
        }}
        aria-label="How Spark decides"
      >
        {/* The smeared marquee band, half in the indigo, half in the paper. */}
        <div
          aria-hidden
          className="overflow-hidden pb-6 pt-16"
          style={{
            maskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)",
            WebkitMaskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)",
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
              kind="seen"
              delay={0}
            >
              <DotMatrix />
            </SieveCard>
            <SieveCard
              index="002"
              title="Weighed"
              count={stats.candidates}
              caption="candidate windows scored on dwell, laughter, novelty and named things"
              kind="weighed"
              delay={110}
            >
              <ScoreBars candidates={stats.candidates} kept={stats.moments} />
            </SieveCard>
            <SieveCard
              index="003"
              title="Kept"
              count={stats.moments}
              caption="moments rebuilt in 3D, scored to music, pinned to the real park"
              kind="kept"
              delay={220}
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

      {/* ── IV · the gallery ───────────────────────────────────────────── */}
      <section
        data-gallery
        className="papergrain relative flex flex-col justify-center overflow-hidden bg-paper py-20 lg:h-svh lg:py-0"
        aria-label="The six kept moments"
      >
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 data-reveal className="text-[clamp(2.4rem,5vw,4rem)] leading-[1.04] text-spruce">
              Six moments, kept.
            </h2>
            <p data-reveal className="fnote pb-2 text-[11px] text-ink-faint">
              [ SIX OF {stats.candidates} CANDIDATE MINUTES · EACH ONE OWNS AN INK ]
            </p>
          </div>
        </div>

        <div data-gallery-viewport className="relative z-10 mt-10 w-full overflow-x-auto scrollbar-none">
          <div
            data-gallery-track
            className="flex w-max items-stretch gap-5 px-5 sm:px-8 lg:pl-[max(2rem,calc((100vw-72rem)/2+2rem))] lg:pr-[36vw]"
          >
            {moments.map((mo, i) => {
              const ink = PAPER_INKS[i % PAPER_INKS.length];
              return (
                <Link key={mo.id} href={`/walk?m=${mo.id}`} className="group block shrink-0">
                  <article
                    className="ink-halo relative flex h-full w-[82vw] max-w-[430px] flex-col overflow-hidden rounded-[14px] bg-vellum p-4 transition-transform duration-300 ease-(--ease-signature) group-hover:-translate-y-1.5 sm:w-[430px]"
                    style={{ "--ink": ink } as React.CSSProperties}
                  >
                    <p
                      aria-hidden
                      className="fnote pointer-events-none absolute right-2 top-1 text-[5.2rem] font-medium leading-none tracking-normal opacity-[0.1]"
                      style={{ color: ink }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <div className="relative overflow-hidden rounded-[10px]">
                      <KeyframeImg
                        keyframe={{ placeholderSeed: mo.seed, hue: mo.hue, url: mo.url }}
                        alt={`Keyframe stand-in for “${mo.title}”`}
                        width={840}
                        height={630}
                        className="aspect-[4/3] w-full object-cover transition-transform duration-500 ease-(--ease-reveal) group-hover:scale-[1.03]"
                      />
                      <span className="fnote absolute left-3 top-3 rounded-full bg-ink/80 px-2.5 py-1 text-[10px] text-paper">
                        {mo.clock}
                      </span>
                      {mo.hasMusic && (
                        <span className="fnote absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[9.5px] text-paper">
                          <Music size={10} strokeWidth={1.75} aria-hidden /> SCORED
                        </span>
                      )}
                    </div>
                    <p className="fnote mt-4 flex items-center gap-2 text-[10.5px] text-ink-faint">
                      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: ink }} />
                      {mo.place} · {mo.length} · {mo.mood}
                    </p>
                    <h3 className="mt-2 text-[22px] leading-snug text-ink">{mo.title}</h3>
                    <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">{mo.summary}</p>
                    <p className="mt-auto flex items-center gap-1.5 pt-4 text-[13px] font-semibold" style={{ color: ink }}>
                      Step inside
                      <ArrowUpRight
                        size={13}
                        strokeWidth={2}
                        className="transition-transform duration-300 ease-(--ease-signature) group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                        aria-hidden
                      />
                    </p>
                  </article>
                </Link>
              );
            })}
          </div>
        </div>

        {/* The evening's rail — scrubbed by the gallery on desktop. */}
        <div aria-hidden className="relative z-10 mx-auto mt-10 hidden w-full max-w-3xl items-center gap-4 px-8 lg:flex">
          <span className="fnote text-[10.5px] text-ink-faint">{moments[0]?.clock}</span>
          <div className="relative h-[2px] flex-1 rounded-full bg-ink/15">
            <div
              data-rail-fill
              className="absolute inset-0 origin-left rounded-full"
              style={{ background: `linear-gradient(90deg, ${BRASS}, ${CLAY})` }}
            />
            {moments.map((mo, i) => (
              <span
                key={mo.id}
                data-rail-dot
                className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,transform] duration-300"
                style={{
                  left: `${moments.length > 1 ? (i / (moments.length - 1)) * 100 : 0}%`,
                  background: PAPER_INKS[i % PAPER_INKS.length],
                }}
              />
            ))}
          </div>
          <span className="fnote text-[10.5px] text-ink-faint">{moments[moments.length - 1]?.clock}</span>
        </div>
      </section>

      {/* ── V · the crossed-out pages ──────────────────────────────────── */}
      <section data-ledger className="papergrain relative bg-paper" aria-label="The discarded candidates">
        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-28">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 data-reveal className="text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.06] text-spruce">
              The crossed-out pages.
            </h2>
            <p data-reveal className="max-w-[46ch] text-[14.5px] leading-relaxed text-ink-soft">
              The sieve&apos;s rejects, kept on the record. Each one fired a real trigger — and
              each one lost to something better. An honest journal shows its working.
            </p>
          </div>

          <ul className="mt-10 divide-y divide-ink/10 border-y border-ink/10">
            {discards.map((d, i) => (
              <li
                key={d.id}
                data-reveal
                style={{ "--reveal-delay": `${i * 60}ms` } as React.CSSProperties}
                className="grid gap-2 py-5 sm:grid-cols-[110px_1fr_auto] sm:items-baseline sm:gap-6"
              >
                <p className="fnote text-[11px] text-ink-faint">
                  {d.clock} · {d.length}
                </p>
                <div>
                  <p className="text-[15px] text-ink">{d.trigger}</p>
                  <p className="mt-1 text-[13px] italic text-ink-soft">{d.reason}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-ink/10">
                    <span
                      data-score-bar
                      className="block h-full rounded-full bg-clay/70"
                      style={{ width: `${Math.round((d.score / maxScore) * 100)}%` }}
                    />
                  </span>
                  <span className="fnote text-[10px] tracking-[0.2em] text-clay">[ DISCARDED ]</span>
                </div>
              </li>
            ))}
          </ul>
          <p data-reveal className="fnote mt-6 text-[11px] text-ink-faint">
            [ Full audit trail on the detector bench ]
          </p>
        </div>
      </section>

      {/* ── VI · the dragged statement ─────────────────────────────────── */}
      <section
        data-statement
        aria-label="Not every minute is worth keeping"
        className="relative overflow-hidden border-y border-ink/10 bg-paper py-16 sm:py-24"
      >
        <p
          data-statement-track
          className="whitespace-nowrap text-[clamp(3.4rem,9vw,7.5rem)] font-medium leading-none tracking-tight text-ink"
        >
          Not every minute is worth keeping. <span className="text-clay">Six were.</span>{" "}
          <span className="text-ink/35">Not every minute is worth keeping.</span>
        </p>
      </section>

      {/* ── VII · field notes ──────────────────────────────────────────── */}
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
            <div
              key={note}
              className="border-t border-ink/15 pt-6 sm:min-h-[240px]"
              style={{ animation: "takeover 0.4s var(--ease-reveal) both" }}
            >
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

      {/* ── VIII · finale ──────────────────────────────────────────────── */}
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
            WebkitMaskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)",
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
  );
}

/* ── Act III plates ─────────────────────────────────────────────────────── */

function SieveCard({
  index,
  title,
  count,
  caption,
  kind,
  delay,
  accent = false,
  children,
}: {
  index: string;
  title: string;
  count: number;
  caption: string;
  kind: "seen" | "weighed" | "kept";
  delay: number;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      data-reveal
      data-plate={kind}
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
      className="starfield relative overflow-hidden rounded-[14px] bg-spruce p-6 shadow-[inset_0_0_0_1px_rgb(243_239_251_/_0.14),0_18px_40px_-22px_rgb(27_27_24_/_0.55)]"
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
          className={`dm-dot ${d.hot > 0.55 ? "dm-hot" : ""}`}
          cx={12 + d.x * 19.5}
          cy={12 + d.y * 19}
          // Two decimals — full-precision floats can serialize differently on
          // the server and the client, which trips hydration.
          r={Math.round((2.1 + d.hot * 2.6) * 100) / 100}
          fill={d.hot > 0.55 ? BRASS : "rgb(243 239 251 / 0.28)"}
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
  const aboveIdx = new Set(Array.from({ length: kept }, (_, k) => Math.floor((k * candidates) / kept)));
  const bars = Array.from({ length: candidates }, (_, i) => {
    const v = aboveIdx.has(i) ? LINE + 0.08 + rand() * 0.28 : 0.16 + rand() * (LINE - 0.24);
    return Math.round(v * 100) / 100;
  });
  const step = 244 / bars.length;
  return (
    <svg viewBox="0 0 260 140" className="h-full w-auto" aria-hidden>
      {bars.map((v, i) => (
        <rect
          key={i}
          className={`sb-bar ${v >= LINE ? "sb-kept" : ""}`}
          x={Math.round((10 + i * step) * 10) / 10}
          y={126 - v * 104}
          width={Math.min(13, step * 0.62)}
          height={v * 104}
          rx={2.5}
          fill={v >= LINE ? BRASS : "rgb(243 239 251 / 0.26)"}
        />
      ))}
      <line
        className="sb-line"
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

/** [ 003 ] — six teardrop pins walking onto the route. */
function PinRow() {
  const inks = [BRASS, CLAY, "#7d7730", "#8fb3ad", BRASS, CLAY];
  return (
    <svg viewBox="0 0 260 140" className="h-full w-auto" aria-hidden>
      <path
        className="pr-path"
        d="M14 108 C 60 84, 96 122, 138 96 S 224 66, 248 84"
        fill="none"
        stroke="rgb(243 239 251 / 0.3)"
        strokeWidth={1.6}
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      {inks.map((ink, i) => {
        const x = 24 + i * 42;
        const y = [104, 92, 110, 90, 78, 86][i];
        return (
          <g key={i} className="pr-pin" transform={`translate(${x} ${y})`}>
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
