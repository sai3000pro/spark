"use client";

/**
 * The landing: the night the robot walked, pressed into its field journal.
 *
 * I    Hero — the painted aurora scene, the blob companion asleep on the path
 *      (hover wakes it; it IS the start-a-trip button), and the kept moments
 *      lapping under it as the seam into the journal.
 * II   The sieve — one pinned typeset scene on paper: everything the robot
 *      noticed, set as words on the page; scrolling crosses them out in ink,
 *      one by one, until six circled entries remain. "It kept six."
 * III  How it decides — the smeared marquee band, then Seen / Weighed / Kept
 *      as three dark plates whose instruments draw themselves and then stay
 *      alive: detections twinkle, the keep-line's dashes march, and a brass
 *      dot laps the route past six surveyor's markers breathing sonar rings.
 * IV   Six moments, kept — a horizontal shelf of taped-down photographs on
 *      vellum mats, pinned to the scroll on desktop; the prints parallax in
 *      their windows and the shelf shears with scroll velocity.
 * V    The crossed-out pages — every discarded candidate, its trigger, score
 *      and the exact reason it lost. Honesty as a section, not a footnote.
 * VI   The statement — three lines that each fit the page, drifting apart as
 *      they pass, with "Six were." circled in clay.
 * VII  The field notes — a numbered index whose active entry is circled by
 *      the same pen, answered on a taped, ruled, stamped sheet.
 * VIII The shelf — every album the robot has pressed, as taped vellum prints;
 *      the aurora library folded into the journal's own language.
 * IX   Finale — pine again, the giant wordmark with the pane of glass
 *      floating dead-centre over it.
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
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import { ArrowDown, ArrowUpRight, Music, Plus, RotateCw, Volume2, VolumeX } from "lucide-react";
import { LandingHero } from "@/components/hero/LandingHero";
import { LiveTripProvider } from "@/components/shell/LiveTripProvider";
import { KeyframeImg } from "@/components/system/ui";
import { distance, duration, shortDate } from "@/lib/format";
import type { ActiveTripSnapshot } from "@/lib/liveTrip";
import { BRASS, CLAY, MOMENT_INKS } from "@/lib/theme";
import type { TripListItem } from "@/lib/tripData";

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
  /** Every pressed album, for the shelf. */
  albums: TripListItem[];
  /** Live-trip snapshot — the hero's blob announces a walk in progress. */
  active: ActiveTripSnapshot | null;
}

gsap.registerPlugin(ScrollTrigger, CustomEase, SplitText);

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

export function Landing({ dateLabel, placeLabel, stats, noticed, moments, discards, albums, active }: LandingProps) {
  const root = useRef<HTMLDivElement>(null);
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
      // html/body are height:100%, so Lenis's ResizeObserver (which watches
      // documentElement's box, not its scrollHeight) never fires when pin
      // spacers inflate the page — its scroll limit goes stale and the wheel
      // stops short of the bottom. Re-measure after every ScrollTrigger
      // refresh, which is exactly when the pin spacers change the height.
      const remeasure = () => lenis.resize();
      ScrollTrigger.addEventListener("refresh", remeasure);
      lenis.resize();
      return () => {
        ScrollTrigger.removeEventListener("refresh", remeasure);
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
          // Idle: the keep-line's dashes keep marching (the threshold is a
          // live measurement) and the kept bars glow like held breath.
          const march = gsap.to(plate.querySelector(".sb-line"), {
            strokeDashoffset: -20,
            duration: 2.2,
            ease: "none",
            repeat: -1,
          });
          const held = gsap.to(plate.querySelectorAll(".sb-kept"), {
            opacity: 0.55,
            duration: 1.7,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            stagger: 0.4,
          });
          killers.push(() => {
            march.kill();
            held.kill();
          });
        } else if (kind === "kept") {
          const path = plate.querySelector<SVGPathElement>(".pr-path");
          tl.from(path, { opacity: 0, duration: 0.7 }).from(
            plate.querySelectorAll(".pr-pin"),
            { y: -26, opacity: 0, scale: 0.5, transformOrigin: "50% 100%", duration: 0.6, stagger: 0.09 },
            "-=0.4",
          );
          // Idle: the dotted route keeps walking, the robot (a brass dot)
          // laps it, and each marker breathes a sonar ring.
          const walkDots = gsap.to(path, { strokeDashoffset: -16, duration: 1.8, ease: "none", repeat: -1 });
          const halos = gsap.fromTo(
            plate.querySelectorAll(".pr-halo"),
            { attr: { r: 7 }, opacity: 0.5 },
            {
              attr: { r: 15 },
              opacity: 0,
              duration: 2.1,
              ease: "power1.out",
              repeat: -1,
              stagger: 0.35,
            },
          );
          const traveler = plate.querySelector<SVGCircleElement>(".pr-traveler");
          let lap: gsap.core.Tween | null = null;
          if (path && traveler) {
            const len = path.getTotalLength();
            const proxy = { t: 0 };
            lap = gsap.to(proxy, {
              t: 1,
              duration: 8,
              ease: "none",
              repeat: -1,
              onUpdate: () => {
                const p = path.getPointAtLength(proxy.t * len);
                traveler.setAttribute("cx", String(p.x));
                traveler.setAttribute("cy", String(p.y));
              },
            });
          }
          killers.push(() => {
            walkDots.kill();
            halos.kill();
            lap?.kill();
          });
        }
        killers.push(() => {
          tl.scrollTrigger?.kill();
          tl.kill();
        });
      });

      // The statement — three stacked lines that each fit the page, drifting
      // in opposite directions as the section passes. Every line is readable
      // at every scroll position; the drift is texture, not travel.
      el.querySelectorAll<HTMLElement>("[data-drift]").forEach((line) => {
        const v = Number(line.dataset.drift ?? 0);
        const drift = gsap.fromTo(
          line,
          { xPercent: v },
          {
            xPercent: -v,
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
          drift.scrollTrigger?.kill();
          drift.kill();
        });
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

      // Line reveals — section headings rise line-by-line with the ink still
      // wet (translate + blur + fade; no clipping masks, so tight leading
      // keeps its descenders). Split only after the fonts settle so the line
      // breaks are the real ones; disposed through the same killers.
      {
        const lineTargets = Array.from(el.querySelectorAll<HTMLElement>("[data-lines]"));
        let cancelled = false;
        const disposers: Array<() => void> = [];
        if (lineTargets.length) {
          document.fonts.ready.then(() => {
            if (cancelled) return;
            lineTargets.forEach((node) => {
              const split = SplitText.create(node, { type: "lines" });
              const tween = gsap.from(split.lines, {
                yPercent: 55,
                opacity: 0,
                filter: "blur(6px)",
                duration: 0.9,
                ease: "reveal",
                stagger: 0.1,
                scrollTrigger: { trigger: node, start: "top 85%", once: true },
              });
              disposers.push(() => {
                tween.scrollTrigger?.kill();
                tween.kill();
                split.revert();
              });
            });
            ScrollTrigger.refresh();
          });
        }
        killers.push(() => {
          cancelled = true;
          disposers.forEach((d) => d());
        });
      }

      // Deep links land where they aimed. The pinned sections inflate the page
      // AFTER the browser's initial hash jump, so /#albums would strand the
      // visitor two spacers short — re-run the jump once the pins have
      // measured (the first ScrollTrigger refresh after setup).
      if (window.location.hash) {
        const target = document.querySelector(window.location.hash);
        if (target) {
          const reanchor = () => {
            target.scrollIntoView();
            ScrollTrigger.removeEventListener("refresh", reanchor);
          };
          ScrollTrigger.addEventListener("refresh", reanchor);
          killers.push(() => ScrollTrigger.removeEventListener("refresh", reanchor));
        }
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

    // ── The gallery deck: desktop + motion only. A pile of prints in the
    // robot's hand — each scroll beat flicks the top one off the pile
    // (alternating left/right, the way you'd deal photographs onto a table)
    // while the journal entry beside it swaps. The CSS deck/strip swap is
    // keyed to html.reveal-armed, so everyone else keeps the native strip. ──
    mm.add("(min-width: 1025px) and (prefers-reduced-motion: no-preference)", () => {
      const el = root.current!;
      const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-deck-card]"));
      const texts = Array.from(el.querySelectorAll<HTMLElement>("[data-deck-text]"));
      const fill = el.querySelector<HTMLElement>("[data-deck-fill]");
      if (cards.length < 2) return;
      const n = cards.length;
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: "[data-deck]",
          start: "top top",
          end: () => "+=" + Math.round((n - 0.4) * window.innerHeight * 0.85),
          scrub: 0.6,
          pin: true,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onUpdate: (st) => {
            if (fill) fill.style.transform = `scaleX(${st.progress})`;
          },
        },
      });
      // Time 0 = the full pile, first entry showing. The cards' markup
      // rotation is their resting tilt; underneath cards start a hair small,
      // so each reveal is a settle, not a pop.
      cards.forEach((c, i) => {
        tl.set(
          c,
          { xPercent: 0, yPercent: 0, autoAlpha: 1, rotation: Number(c.dataset.tilt ?? 0), scale: i === 0 ? 1 : 0.965 },
          0,
        );
      });
      texts.forEach((t, i) => tl.set(t, { autoAlpha: i === 0 ? 1 : 0, y: i === 0 ? 0 : 18 }, 0));
      for (let i = 0; i < n - 1; i++) {
        const at = i + 0.3;
        const dir = i % 2 ? 1 : -1;
        const tilt = Number(cards[i].dataset.tilt ?? 0);
        tl.to(cards[i], { xPercent: dir * 140, yPercent: -12, rotation: tilt + dir * 24, duration: 0.7, ease: "signature" }, at)
          .to(cards[i], { autoAlpha: 0, duration: 0.22, ease: "none" }, at + 0.5)
          .to(cards[i + 1], { scale: 1, duration: 0.5, ease: "reveal" }, at + 0.25)
          .to(texts[i], { autoAlpha: 0, y: -16, duration: 0.28, ease: "signature" }, at)
          .to(texts[i + 1], { autoAlpha: 1, y: 0, duration: 0.4, ease: "reveal" }, at + 0.3);
      }
      tl.to({}, { duration: 0.6 });
      return () => {
        tl.scrollTrigger?.kill();
        tl.kill();
        if (fill) fill.style.transform = "";
        gsap.set([...cards, ...texts], { clearProps: "transform,opacity,visibility" });
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
          <span aria-hidden className="pulse-dot inline-block h-[7px] w-[7px] rounded-full bg-clay" />
        </Link>
        <nav className="flex items-center gap-3 sm:gap-5">
          <a href="#albums" className="link-pen hidden text-[13.5px] text-milk/85 transition-colors hover:text-milk md:block">
            Albums
          </a>
          <Link href="/walk" className="link-pen hidden text-[13.5px] text-milk/85 transition-colors hover:text-milk sm:block">
            The walk
          </Link>
          <Link href="/detect" className="link-pen hidden text-[13.5px] text-milk/85 transition-colors hover:text-milk sm:block">
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

      {/* ── I · hero — the painted night the robot walked ──────────────────
          The aurora scene, whole: art-directed plates, the live CSS aurora and
          fireflies, and the blob companion asleep on the path (hover wakes it —
          it IS the start-a-trip button, announcing a live walk when one runs).
          `.aurora-app` scopes the scene's own tokens; --appbar-h matches the
          glass bar so the plate fills exactly one viewport beneath it, and the
          inline min-height override stops the scope class from padding the
          scene to 100vh and leaving a bare navy band under the fold. */}
      <div
        className="aurora-app relative"
        style={{ "--appbar-h": "57px", minHeight: 0 } as React.CSSProperties}
      >
        <LiveTripProvider initial={active}>
          <LandingHero />
        </LiveTripProvider>
      </div>

      {/* The seam: the kept moments lapping like a ticker of the day — the
          night scene handing off to the journal that pressed it. */}
      <div
        aria-hidden
        className="relative overflow-hidden border-y border-milk/10 bg-pine py-4"
        style={{
          maskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
          WebkitMaskImage: "linear-gradient(90deg, transparent, black 10%, black 90%, transparent)",
        }}
      >
        <div className="marquee-track flex w-max whitespace-nowrap" style={{ "--marquee-dur": "46s" } as React.CSSProperties}>
          {[0, 1].map((dup) => (
            <span key={dup} className="fnote text-[12px] tracking-[0.18em] text-brass/70">
              {dateLabel} · {placeLabel}  ·  {moments.map((mo) => `${mo.clock} — ${mo.title}`).join("  ·  ")}
              {"  ·  "}
            </span>
          ))}
        </div>
      </div>

      {/* ── II · the sieve ─────────────────────────────────────────────── */}
      <section
        data-sieve
        id="journal"
        tabIndex={-1}
        className="papergrain gridfield relative flex h-svh min-h-[620px] flex-col overflow-hidden bg-paper outline-none"
        aria-label="Everything the robot noticed, crossed out down to what it kept"
      >
        {/* Captions. C is the markup default — the no-JS and reduced-motion
            resting state; A and B are staged in by the timeline. */}
        <div className="pointer-events-none absolute inset-x-0 top-[15%] z-10 px-6 text-center">
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
        <div className="relative z-0 mx-auto flex w-full max-w-4xl flex-1 flex-wrap content-center items-baseline justify-center gap-x-4 gap-y-2.5 px-6 pb-[16vh] pt-[26vh] sm:gap-x-5 sm:gap-y-3">
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

      {/* ── IV · the gallery deck ──────────────────────────────────────── */}
      <section
        data-deck
        className="papergrain gridfield relative overflow-hidden bg-paper"
        aria-label="The six kept moments"
      >
        {/* The deck — CSS swaps it in (and the strip out) once motion JS
            arms, desktop only: a pile of prints in the hand, the top one
            flicked aside on each scroll beat while the entry swaps. */}
        <div className="deck-when-armed relative hidden h-svh min-h-[640px]">
          <div className="pointer-events-none absolute inset-x-0 top-[8%] z-10">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-4 px-8">
              <h2 data-lines className="text-[clamp(2.4rem,5vw,4rem)] leading-[1.04] text-spruce">Six moments, kept.</h2>
              <p className="fnote pb-2 text-[11px] text-ink-faint">[ SCROLL — LEAF THROUGH THE PRINTS ]</p>
            </div>
          </div>
          <div className="mx-auto grid h-full w-full max-w-6xl grid-cols-[minmax(320px,5fr)_minmax(0,7fr)] items-center gap-12 px-8 pt-[9vh]">
            <div className="relative z-10 h-[min(52vh,460px)]">
              {moments.map((mo, i) => {
                const ink = PAPER_INKS[i % PAPER_INKS.length];
                return (
                  <div
                    key={mo.id}
                    data-deck-text
                    className={`absolute inset-0 flex flex-col justify-center ${i === 0 ? "" : "invisible opacity-0"}`}
                  >
                    <p className="fnote text-[11px] text-ink-faint">
                      [ {String(i + 1).padStart(2, "0")} / {String(moments.length).padStart(2, "0")} · {mo.clock} ]
                    </p>
                    <h3 className="mt-4 text-[clamp(1.9rem,3.2vw,2.9rem)] leading-[1.06] text-ink">{mo.title}</h3>
                    <p className="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-ink-soft">{mo.summary}</p>
                    <p className="fnote mt-5 flex items-center gap-2 text-[10.5px] text-ink-faint">
                      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: ink }} />
                      {mo.place} · {mo.length} · {mo.mood}
                    </p>
                    <Link href={`/walk?m=${mo.id}`} className="pill-ghost mt-7 w-fit px-5 py-2.5 text-[14px] text-ink">
                      Step inside
                      <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden />
                    </Link>
                  </div>
                );
              })}
              <div aria-hidden className="absolute bottom-0 left-0 flex w-full max-w-[260px] items-center gap-3">
                <span className="fnote text-[10px] text-ink-faint">{moments[0]?.clock}</span>
                <span className="relative h-[2px] flex-1 overflow-hidden rounded-full bg-ink/15">
                  <span
                    data-deck-fill
                    className="absolute inset-0 origin-left rounded-full"
                    style={{ background: `linear-gradient(90deg, ${BRASS}, ${CLAY})`, transform: "scaleX(0)" }}
                  />
                </span>
                <span className="fnote text-[10px] text-ink-faint">{moments[moments.length - 1]?.clock}</span>
              </div>
            </div>
            <div className="relative flex h-full items-center justify-center">
              {moments.map((mo, i) => {
                const ink = PAPER_INKS[i % PAPER_INKS.length];
                const tilt = [-2.1, 1.7, -1.2, 2.3, -1.7, 1.1][i % 6];
                return (
                  <article
                    key={mo.id}
                    data-deck-card
                    data-tilt={tilt}
                    className="papergrain absolute w-[min(34vw,470px)] bg-vellum p-3 shadow-[0_2px_4px_rgb(27_27_24_/_0.08),0_28px_50px_-26px_rgb(27_27_24_/_0.55)]"
                    style={{ transform: `rotate(${tilt}deg)`, zIndex: moments.length - i }}
                  >
                    <PrintMat mo={mo} index={i} ink={ink} />
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        {/* The strip — mobile, tablet, no-JS and reduced motion: the same
            mounted prints on a native horizontal scroll. */}
        <div className="strip-when-armed py-20">
          <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 data-lines className="text-[clamp(2.4rem,5vw,4rem)] leading-[1.04] text-spruce">
                Six moments, kept.
              </h2>
              <p data-reveal className="fnote pb-2 text-[11px] text-ink-faint">
                [ SIX OF {stats.candidates} CANDIDATE MINUTES · EACH ONE OWNS AN INK ]
              </p>
            </div>
          </div>
          <div className="relative z-10 mt-10 w-full overflow-x-auto scrollbar-none">
            <div className="flex w-max items-start gap-9 px-5 pt-4 sm:px-8">
              {moments.map((mo, i) => {
                const ink = PAPER_INKS[i % PAPER_INKS.length];
                const tilt = [-1.3, 1.1, -0.9, 1.4, -1.1, 0.8][i % 6];
                return (
                  <Link key={mo.id} href={`/walk?m=${mo.id}`} className="group block w-[78vw] max-w-[390px] shrink-0">
                    <article className="relative" style={{ "--tilt": `${tilt}deg` } as React.CSSProperties}>
                      <div className="papergrain relative rotate-[var(--tilt)] bg-vellum p-3 shadow-[0_2px_4px_rgb(27_27_24_/_0.08),0_24px_44px_-24px_rgb(27_27_24_/_0.5)] transition-transform duration-500 ease-(--ease-reveal) group-hover:-translate-y-2 group-hover:rotate-0">
                        <PrintMat mo={mo} index={i} ink={ink} />
                      </div>
                      <div className="mt-6 px-1">
                        <p className="fnote flex items-center gap-2 text-[10.5px] text-ink-faint">
                          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: ink }} />
                          {mo.place} · {mo.length} · {mo.mood}
                        </p>
                        <h3 className="mt-2 flex items-baseline gap-2 text-[23px] leading-snug text-ink">
                          {mo.title}
                          <ArrowUpRight
                            size={16}
                            strokeWidth={2}
                            className="shrink-0 translate-y-[2px] transition-transform duration-300 ease-(--ease-signature) group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                            style={{ color: ink }}
                            aria-hidden
                          />
                        </h3>
                        <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">{mo.summary}</p>
                      </div>
                    </article>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── V · the crossed-out pages ──────────────────────────────────── */}
      <section data-ledger className="papergrain gridfield relative bg-paper" aria-label="The discarded candidates">
        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-28">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <h2 data-lines className="text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.06] text-spruce">
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
                className="group/row grid gap-2 py-5 transition-colors duration-300 hover:bg-ink/[0.03] sm:grid-cols-[110px_1fr_auto] sm:items-baseline sm:gap-6"
              >
                <p className="fnote text-[11px] text-ink-faint">
                  {d.clock} · {d.length}
                </p>
                <div className="transition-transform duration-300 ease-(--ease-signature) group-hover/row:translate-x-1">
                  <p className="text-[15px] text-ink">{d.trigger}</p>
                  <p className="mt-1 text-[13px] italic text-ink-soft">{d.reason}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="h-1 w-24 overflow-hidden rounded-full bg-ink/10">
                    <span
                      data-score-bar
                      className="block h-full rounded-full bg-clay/70 transition-colors duration-300 group-hover/row:bg-clay"
                      style={{ width: `${Math.round((d.score / maxScore) * 100)}%` }}
                    />
                  </span>
                  <span className="fnote inline-block text-[10px] tracking-[0.2em] text-clay transition-transform duration-300 ease-(--ease-signature) group-hover/row:-rotate-3 group-hover/row:scale-105">
                    [ DISCARDED ]
                  </span>
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
        aria-label="Not every minute is worth keeping — six were"
        className="papergrain gridfield relative overflow-hidden border-y border-ink/10 bg-paper py-14 sm:py-20"
      >
        {/* Three lines, each sized to fit the page, drifting apart as the
            section passes — always readable, never driven off the edge. */}
        <div className="relative flex flex-col items-center gap-1 text-center">
          <p
            data-drift="5"
            className="w-max whitespace-nowrap text-[clamp(2.5rem,6.8vw,5.4rem)] font-medium leading-[1.05] tracking-tight text-ink"
          >
            Not every minute
          </p>
          <p
            data-drift="-5"
            className="w-max whitespace-nowrap text-[clamp(2.5rem,6.8vw,5.4rem)] font-medium leading-[1.05] tracking-tight text-ink"
          >
            is worth keeping.
          </p>
          <p
            data-drift="3"
            className="mt-4 w-max whitespace-nowrap text-[clamp(2.9rem,8vw,6.4rem)] font-medium leading-[1.02] tracking-tight text-clay"
          >
            <span data-reveal="fade" data-draw className="relative inline-block px-4">
              Six were.
              <svg
                aria-hidden
                viewBox="0 0 120 44"
                preserveAspectRatio="none"
                className="pointer-events-none absolute -left-[6%] -top-[14%] h-[130%] w-[112%] overflow-visible"
              >
                <path
                  data-draw-path
                  pathLength={100}
                  d="M8 24 C 8 9, 38 3, 62 4 C 92 5, 114 11, 113 22 C 112 35, 84 41, 56 40 C 28 39, 9 34, 8 25"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeDasharray={103}
                  strokeLinecap="round"
                />
              </svg>
            </span>
          </p>
        </div>
      </section>

      {/* ── VII · field notes ──────────────────────────────────────────── */}
      <section className="papergrain gridfield relative bg-paper py-20 sm:py-24" aria-label="Field notes">
        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 data-lines className="text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.06] text-spruce">
              Field notes
            </h2>
            <p data-reveal className="fnote pb-2 text-[11px] text-ink-faint">
              [ THE QUESTIONS PEOPLE ACTUALLY ASK ]
            </p>
          </div>

          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(300px,2fr)_3fr]">
            {/* The index: numbered entries straight on the page. Selecting one
                circles its number in clay — the same pen as the sieve. */}
            <ul data-reveal className="border-t border-ink/15">
              {FIELD_NOTES.map((q, i) => (
                <li key={q.q}>
                  <button
                    onClick={() => setNote(i)}
                    aria-expanded={note === i}
                    className="group/n flex w-full items-baseline gap-5 border-b border-ink/15 py-5 text-left"
                  >
                    <span
                      className={`note-ring fnote relative shrink-0 text-[11px] transition-colors duration-300 ${
                        note === i ? "text-clay" : "text-ink-faint"
                      }`}
                    >
                      {String(i + 1).padStart(2, "0")}
                      <svg
                        aria-hidden
                        viewBox="0 0 120 44"
                        preserveAspectRatio="none"
                        className="pointer-events-none absolute -left-2.5 -top-[7px] h-[calc(100%+15px)] w-[calc(100%+20px)] overflow-visible"
                      >
                        <path
                          pathLength={100}
                          d="M8 24 C 8 9, 38 3, 62 4 C 92 5, 114 11, 113 22 C 112 35, 84 41, 56 40 C 28 39, 9 34, 8 25"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.8}
                          strokeDasharray={103}
                          strokeLinecap="round"
                        />
                      </svg>
                    </span>
                    <span
                      className={`text-[17px] leading-snug transition-[color,translate] duration-300 ease-(--ease-signature) ${
                        note === i ? "text-ink" : "text-ink-soft group-hover/n:translate-x-1 group-hover/n:text-ink"
                      }`}
                    >
                      {q.q}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* The answer: a loose sheet taped over the page — ruled feint
                lines, the writing sitting on them, a clay stamp in the corner. */}
            <div
              data-reveal
              style={{ "--reveal-delay": "120ms" } as React.CSSProperties}
              className="papergrain relative rotate-[-0.4deg] bg-vellum px-7 pb-7 pt-9 shadow-[0_2px_4px_rgb(27_27_24_/_0.07),0_26px_48px_-28px_rgb(27_27_24_/_0.45)] sm:px-9 sm:pb-9"
            >
              <span aria-hidden className="tape -top-2.5 left-8 -rotate-3" />
              <span aria-hidden className="tape -top-2.5 right-10 rotate-2" />
              <div key={note} style={{ animation: "takeover 0.4s var(--ease-reveal) both" }}>
                <div className="flex items-start justify-between gap-4">
                  <h3 className="max-w-[24ch] text-[21px] leading-snug text-ink">{FIELD_NOTES[note].q}</h3>
                  <p aria-hidden className="stamp fnote mt-1 shrink-0 text-[9.5px] text-clay">
                    NOTE {String(note + 1).padStart(2, "0")}
                  </p>
                </div>
                <div className="ruled mt-5 sm:min-h-[196px]">
                  {FIELD_NOTES[note].a.map((para) => (
                    <p
                      key={para.slice(0, 24)}
                      className="mt-[28px] max-w-[60ch] text-[15px] leading-[28px] text-ink-soft first:mt-0"
                    >
                      {para}
                    </p>
                  ))}
                </div>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-10 gap-y-6 border-t border-ink/15 pt-6">
                <Receipt value={stats.distance} label="walked, never in the way" />
                <Receipt value={stats.duration} label="of one Sunday evening" />
                <Receipt value={String(stats.objects)} label="things it can still point to" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── VIII · the shelf ───────────────────────────────────────────────
          The aurora library, folded into the journal: every album the robot
          has pressed, mounted as taped vellum prints. One walk is told above;
          the rest live here. */}
      <section
        id="albums"
        tabIndex={-1}
        className="papergrain gridfield relative border-t border-ink/10 bg-paper py-20 outline-none sm:py-24"
        aria-label="Every album on the shelf"
      >
        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <h2 data-lines className="text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.06] text-spruce">
              The shelf.
            </h2>
            <p data-reveal className="fnote pb-2 text-[11px] text-ink-faint">
              [ {albums.length} ALBUMS · ONE EVENING TOLD ABOVE ]
            </p>
          </div>

          <div className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {albums.map((t, i) => {
              const tilt = [-0.9, 0.7, -0.5, 0.9, -0.7, 0.5, -0.8][i % 7];
              return (
                <Link
                  key={t.id}
                  href={`/trip/${t.id}`}
                  data-reveal
                  style={{ "--reveal-delay": `${(i % 3) * 90}ms`, "--tilt": `${tilt}deg` } as React.CSSProperties}
                  className="group block"
                >
                  <article className="relative">
                    <div className="papergrain relative rotate-[var(--tilt)] bg-vellum p-3 shadow-[0_2px_4px_rgb(27_27_24_/_0.08),0_24px_44px_-24px_rgb(27_27_24_/_0.5)] transition-transform duration-500 ease-(--ease-reveal) group-hover:-translate-y-2 group-hover:rotate-0">
                      <span aria-hidden className="tape -top-2.5 left-6 -rotate-5" />
                      <span aria-hidden className="tape -top-2.5 right-8 rotate-3" />
                      {/* Odd counts still fill the mat: with 1 or 3 prints the
                          first goes full-width, so the collage never shows a
                          bare quadrant. */}
                      <div className="grid grid-cols-2 gap-1 overflow-hidden">
                        {t.momentThumbs.slice(0, 4).map((th, k, arr) => {
                          const wide = arr.length % 2 === 1 && k === 0;
                          return (
                            <KeyframeImg
                              key={k}
                              keyframe={{ placeholderSeed: th.seed, hue: th.hue, url: th.url }}
                              alt=""
                              width={420}
                              height={315}
                              className={`w-full object-cover ${wide ? "col-span-2 aspect-[8/3]" : "aspect-[4/3]"}`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex items-baseline justify-between pt-2.5">
                        <p className="fnote text-[10px] text-ink-faint">[ {String(i + 1).padStart(3, "0")} ]</p>
                        <p className="fnote text-[10px] text-ink-faint">{shortDate(t.startedAt)}</p>
                      </div>
                    </div>
                    <div className="mt-4 px-1">
                      <h3 className="flex items-baseline gap-2 text-[21px] leading-snug text-ink">
                        {t.title}
                        <ArrowUpRight
                          size={15}
                          strokeWidth={2}
                          className="shrink-0 translate-y-[2px] text-brass-deep transition-transform duration-300 ease-(--ease-signature) group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                          aria-hidden
                        />
                      </h3>
                      <p className="tag mt-1 text-[12.5px] text-ink-soft">
                        {t.placeLabel} · {t.stats.momentCount} moments · {distance(t.stats.distanceM)} ·{" "}
                        {duration(t.stats.durationSec)}
                      </p>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── IX · finale ────────────────────────────────────────────────── */}
      <section className="dotfield starfield relative overflow-hidden bg-pine pb-10 sm:pb-14" aria-label="Enter the app">
        <div className="relative z-10 mx-auto max-w-6xl px-5 pt-24 sm:px-8 sm:pt-32">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <h2 data-lines className="text-[clamp(2.6rem,5.6vw,4.6rem)] leading-[1.05] text-milk">
              The walk is over…
              <br />
              <span className="text-brass">The memory isn{"'"}t.</span>
            </h2>
            <Link href="/walk" data-reveal className="pill-brass mb-2 px-6 py-3 text-[15px]">
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
          {/* One pane of glass — in flow on small screens, floating dead-centre
              over the wordmark on large ones. */}
          <footer className="relative z-10 mx-4 mt-10 sm:mx-10 lg:absolute lg:left-1/2 lg:top-1/2 lg:mx-0 lg:mt-0 lg:w-full lg:max-w-5xl lg:-translate-x-1/2 lg:-translate-y-1/2">
            <div className="glass-bar flex flex-col items-center gap-5 rounded-2xl px-6 py-5 text-milk sm:flex-row sm:justify-between">
              <nav className="fnote flex gap-5 text-[10.5px]">
                <Link href="/walk" className="link-pen opacity-80 transition-opacity hover:opacity-100">
                  The walk
                </Link>
                <Link href="/detect" className="link-pen opacity-80 transition-opacity hover:opacity-100">
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
            className="pointer-events-none mx-auto mt-6 w-fit whitespace-nowrap text-center text-[clamp(8rem,27vw,23rem)] font-semibold leading-[0.92] tracking-[-0.05em] text-ink lg:mt-0"
          >
            spark
            <span className="pulse-dot ml-[0.02em] inline-block h-[0.13em] w-[0.13em] rounded-full bg-clay align-baseline" />
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

/** [ 003 ] — the walk as a dotted route: six pennant flags mark the kept
    minutes, each flying its moment's luminous ink and breathing a sonar ring,
    while a brass dot — the robot — quietly laps the evening. */
function PinRow() {
  const inks = MOMENT_INKS.map((ink) => ink.base);
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
            <ellipse cx={0} cy={0} rx={4.5} ry={1.6} fill="rgb(243 239 251 / 0.18)" />
            <line x1={0} y1={0} x2={0} y2={-22} stroke={ink} strokeWidth={1.5} strokeLinecap="round" />
            <circle className="pr-halo" cx={0} cy={-18} r={7} fill="none" stroke={ink} strokeWidth={1} opacity={0} />
            <path d={`M0.75 -22 L13 -18.5 L0.75 -15 Z`} fill={ink} />
          </g>
        );
      })}
      <circle className="pr-traveler" cx={14} cy={108} r={3.2} fill={BRASS} />
    </svg>
  );
}

/** The inside of a mounted print: tape, photograph, and the mat's caption.
    The host supplies the vellum mat (padding, shadow, tilt). */
function PrintMat({ mo, index, ink }: { mo: LandingMoment; index: number; ink: string }) {
  return (
    <>
      <span aria-hidden className="tape -top-2.5 left-5 -rotate-6" />
      <span aria-hidden className="tape -top-2.5 right-7 rotate-3" />
      <div className="relative overflow-hidden">
        <KeyframeImg
          keyframe={{ placeholderSeed: mo.seed, hue: mo.hue, url: mo.url }}
          alt={`Keyframe stand-in for “${mo.title}”`}
          width={840}
          height={630}
          className="aspect-[4/3] w-full object-cover"
        />
        {mo.hasMusic && (
          <span className="fnote absolute right-2.5 top-2.5 z-[1] flex items-center gap-1.5 rounded-full bg-ink/80 px-2.5 py-1 text-[9.5px] text-paper">
            <Music size={10} strokeWidth={1.75} aria-hidden /> SCORED
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between pt-2.5">
        <p className="fnote text-[10px] text-ink-faint">[ {String(index + 1).padStart(3, "0")} ]</p>
        <p className="fnote text-[10px]" style={{ color: ink }}>
          {mo.clock}
        </p>
      </div>
    </>
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
    q: "Why keep so little?",
    a: [
      "A camera roll with nine hundred photos of one evening is a place memories go to be lost. Spark's bet is the opposite: a walk survives as the six minutes you'd actually retell.",
      "Everything else is still on the record — counted, timestamped and auditable — it just doesn't get rebuilt in 3D.",
    ],
  },
  {
    q: "What counts as synthetic?",
    a: [
      "Tonight's preview clouds and keyframe stand-ins are generated, and every one of them is labelled on its face. Odometry, detections and the map are measured.",
      "The rule is absolute: nothing synthetic wears a real thing's clothes. Unknown renders as unknown, never as zero.",
    ],
  },
  {
    q: "Where's my water bottle?",
    a: [
      "The robot indexes every distinct thing it sees against the walk's real coordinates. Ask, and it points to the bench where you left the bottle — inside the rebuilt moment, standing where it stood.",
    ],
  },
  {
    q: "Why show the discards?",
    a: [
      "Because a memory machine you can't audit is a stranger editing your life. The bench shows every candidate that fired, its score, and the exact reason it lost.",
      "If the sieve is wrong, you should be able to catch it being wrong.",
    ],
  },
];
