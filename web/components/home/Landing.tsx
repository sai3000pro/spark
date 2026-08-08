"use client";

/**
 * The landing: one long evening walk down the page.
 *
 * I    Hero — the painted park at blue hour, the robot mid-walk. The page
 *      opens inside the illustration; type sits in the open sky.
 * II   It walked with you — the second painting, the follow story.
 * III  Six moments, kept — a quiet grid of the kept moments.
 * IV   The sieve — detections → candidates → moments, honestly.
 * V    A memory is a cloud of light — what a splat is, with key art.
 * VI   Walk it back — the robot cutout and the doors into the app.
 *
 * Motion contract (DESIGN.md): markup defaults are the FINAL state and GSAP
 * animates FROM elsewhere, so no-JS, reduced-motion and ≤1024px all get a
 * complete static page. Desktop + motion-ok gets Lenis smooth scroll, a slow
 * settle on the hero painting, and gentle parallax on both paintings. Exactly
 * two eases, registered under the same names as the CSS custom properties.
 */
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { CustomEase } from "gsap/CustomEase";
import Lenis from "lenis";
import { ArrowRight, MapPin, Music } from "lucide-react";
import keyartHero from "@/public/hero/keyart-hero.webp";
import keyartA from "@/public/hero/keyart-a.webp";
import keyartB from "@/public/hero/keyart-b.webp";
import robotCutout from "@/public/hero/robot-cutout.webp";
import { KeyframeImg } from "@/components/system/ui";
import { inkForMoment } from "@/lib/theme";

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
  stats: {
    distance: string;
    duration: string;
    detections: string;
    detectionsRaw: number;
    candidates: number;
    moments: number;
    objects: number;
  };
  moments: LandingMoment[];
}

gsap.registerPlugin(ScrollTrigger, CustomEase);

export function Landing({ dateLabel, placeLabel, stats, moments }: LandingProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Same beziers as --ease-signature / --ease-reveal in globals.css, so JS
    // motion and CSS motion are literally identical.
    if (!CustomEase.get("signature")) CustomEase.create("signature", "0.785,0.135,0.15,0.86");
    if (!CustomEase.get("reveal")) CustomEase.create("reveal", "0.5,0,0,1");

    const mm = gsap.matchMedia(root);

    // ── Full motion: desktop, motion allowed ────────────────────────────
    mm.add("(min-width: 1025px) and (prefers-reduced-motion: no-preference)", () => {
      const lenis = new Lenis();
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      // The hero painting settles: a slow, single exhale on arrival.
      gsap.from(".hero-art", { scale: 1.07, duration: 2.4, ease: "reveal" });
      // Then drifts slower than the page on the way out.
      gsap.to(".hero-art", {
        yPercent: 14,
        ease: "none",
        scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "bottom top", scrub: 0.4 },
      });
      gsap.to(".hero-copy", {
        yPercent: -30,
        autoAlpha: 0,
        ease: "none",
        scrollTrigger: { trigger: "[data-hero]", start: "top top", end: "70% top", scrub: 0.4 },
      });

      // The second painting parallaxes through its window.
      gsap.fromTo(
        ".keyart-img",
        { yPercent: -9 },
        {
          yPercent: 9,
          ease: "none",
          scrollTrigger: { trigger: "[data-keyart]", start: "top bottom", end: "bottom top", scrub: 0.5 },
        },
      );

      return () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    });

    // ── Everyone with motion: one-shot reveals + count-ups ──────────────
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

  return (
    <div ref={root} className="relative bg-night text-starlight">
      {/* ── Fixed chrome ─────────────────────────────────────────────────── */}
      <header
        className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 sm:px-8"
        style={{
          background:
            "linear-gradient(180deg, rgb(15 13 35 / 0.85) 0%, rgb(15 13 35 / 0.45) 55%, rgb(15 13 35 / 0) 100%)",
        }}
      >
        <Link
          href="/"
          className="font-display text-[21px] leading-none"
          style={{ fontWeight: 560 }}
          aria-label="Spark home"
        >
          Spark
        </Link>
        <nav className="flex items-center gap-2">
          {/* .btn-ghost sets display, so `hidden` must live on a wrapper. */}
          <span className="hidden sm:block">
            <Link href="/detect" className="btn-ghost px-3.5 py-2 text-[13px]">
              Detector bench
            </Link>
          </span>
          <Link href="/walk" className="btn-ember px-3.5 py-2 text-[13px]">
            Open the walk
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Link>
        </nav>
      </header>

      {/* ── I — hero: inside the painting ────────────────────────────────── */}
      <section data-hero className="relative h-svh min-h-[560px] overflow-hidden" aria-label="Introduction">
        <Image
          src={keyartHero}
          alt="Illustration: the Spark robot rolling along a lamp-lit park path at blue hour, a calm lake reflecting the last light"
          fill
          priority
          sizes="100vw"
          placeholder="empty"
          className="hero-art object-cover"
          style={{ objectPosition: "50% 62%" }}
        />
        {/* Bind the painting to the page ground below; keep the sky clear. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgb(15 13 35 / 0.25) 0%, rgb(15 13 35 / 0) 22%, rgb(15 13 35 / 0) 74%, #0f0d23 100%)",
          }}
        />

        <div className="hero-copy relative z-10 mx-auto flex h-full max-w-6xl flex-col px-5 pt-[16vh] sm:px-8 sm:pt-[17vh]">
          <h1
            className="rise-in max-w-[14ch] text-[clamp(2.7rem,6vw,4.75rem)] leading-[1.05]"
            style={{ textShadow: "0 2px 24px rgb(15 13 35 / 0.55)" }}
          >
            A day, remembered in light.
          </h1>
          <p
            className="rise-in mt-5 max-w-[46ch] text-[15.5px] leading-relaxed text-starlight/85 sm:text-[17px]"
            style={{ "--i": 1, textShadow: "0 1px 16px rgb(15 13 35 / 0.6)" } as React.CSSProperties}
          >
            Spark walks behind you, decides what mattered on its own, and rebuilds those moments
            as clouds of captured light you can step back into.
          </p>
          <div className="rise-in mt-7 flex flex-wrap items-center gap-3" style={{ "--i": 2 } as React.CSSProperties}>
            <Link href="/walk" className="btn-ember px-5 py-2.5 text-[14px]">
              Step into the walk
              <ArrowRight size={15} strokeWidth={1.75} aria-hidden />
            </Link>
            <Link href="/detect" className="btn-ghost px-4 py-2.5 text-[14px]">
              See how it decides
            </Link>
          </div>

          <p
            className="rise-in tag mt-auto pb-8 pr-28 text-[12px] text-starlight/70 sm:pr-0"
            style={{ "--i": 4, textShadow: "0 1px 12px rgb(15 13 35 / 0.8)" } as React.CSSProperties}
          >
            {dateLabel} · {placeLabel} · {stats.distance} · {stats.duration} · {stats.moments}{" "}
            moments kept
          </p>
        </div>
      </section>

      {/* ── II — it walked with you ──────────────────────────────────────── */}
      <section data-keyart className="relative overflow-hidden" aria-label="The robot on the walk">
        <div className="relative h-svh min-h-[540px]">
          <Image
            src={keyartA}
            alt="Illustration: the Spark robot rolling along a park path at blue hour, aurora over a dark lake"
            fill
            sizes="100vw"
            placeholder="empty"
            className="keyart-img object-cover"
            style={{ scale: "1.1" }}
          />
          {/* Bind the painting to the page ground at both edges. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0f0d23 0%, rgb(15 13 35 / 0) 20%, rgb(15 13 35 / 0) 66%, #0f0d23 100%)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-6xl px-5 pb-[10vh] sm:px-8">
            <h2 data-reveal className="max-w-[16ch] text-[clamp(2.1rem,4.2vw,3.4rem)] leading-[1.08]">
              It walked with you.
            </h2>
            <p data-reveal className="mt-4 max-w-[48ch] text-[15px] leading-relaxed text-moth sm:text-[16px]">
              {dateLabel}, {placeLabel}. A metre and a half behind, never in the way — watching,
              listening, deciding for itself which minutes were worth keeping.
            </p>
            <p data-reveal className="tag mt-4 text-[12px] text-faint">
              Follow mode · 1.4 m behind · {stats.distance} walked
            </p>
          </div>
        </div>
      </section>

      {/* ── III — six moments, kept ──────────────────────────────────────── */}
      <section className="relative py-24 sm:py-32" aria-label="The kept moments">
        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          <div className="max-w-[56ch]">
            <h2 data-reveal className="text-[clamp(2.1rem,4.2vw,3.4rem)] leading-[1.08]">
              Six moments, kept.
            </h2>
            <p data-reveal className="mt-4 text-[15px] leading-relaxed text-moth">
              Not every minute — six. Each one triggered by something it saw or heard, scored, and
              rebuilt in 3D. Open one to step inside it.
            </p>
          </div>

          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {moments.map((m, i) => {
              const ink = inkForMoment(i);
              return (
                <Link key={m.id} href={`/walk?m=${m.id}`} className="group" data-reveal>
                  <article
                    className="plate overflow-hidden transition-transform duration-300 ease-(--ease-signature) group-hover:-translate-y-1"
                  >
                    <div className="relative">
                      <KeyframeImg
                        keyframe={{ placeholderSeed: m.seed, hue: m.hue, url: m.url }}
                        alt={`Keyframe stand-in for “${m.title}”`}
                        width={840}
                        height={520}
                        className="aspect-[8/5] w-full object-cover"
                      />
                      {m.hasMusic && (
                        <span className="chip tag absolute right-2.5 top-2.5 text-[10px]">
                          <Music size={11} strokeWidth={1.75} aria-hidden /> scored
                        </span>
                      )}
                    </div>
                    <div className="p-4">
                      <p className="tag flex items-center gap-2 text-[12px] text-faint">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: ink.base }}
                        />
                        {m.clock} · {m.length} · {m.place}
                      </p>
                      <h3 className="mt-2 text-[21px] leading-snug">{m.title}</h3>
                      <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-moth">
                        {m.summary}
                      </p>
                      <p className="mt-3.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ember">
                        Step inside
                        <ArrowRight
                          size={13}
                          strokeWidth={1.75}
                          className="transition-transform duration-300 ease-(--ease-signature) group-hover:translate-x-1"
                          aria-hidden
                        />
                      </p>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>

          <div data-reveal className="mt-10 flex justify-center">
            <Link href="/walk" className="btn-ghost px-5 py-2.5 text-[14px]">
              <MapPin size={15} strokeWidth={1.75} className="text-ember" aria-hidden />
              All six, pinned on the real park
            </Link>
          </div>
        </div>
      </section>

      {/* ── IV — the sieve ──────────────────────────────────────────────── */}
      <section className="starfield relative bg-dusk py-24 sm:py-32" aria-label="How Spark decides">
        <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
          <div className="max-w-[56ch]">
            <h2 data-reveal className="text-[clamp(2.1rem,4.2vw,3.4rem)] leading-[1.08]">
              Honest by design.
            </h2>
            <p data-reveal className="mt-4 text-[15px] leading-relaxed text-moth">
              A memory you can audit: everything the robot saw, everything it almost kept, and the
              reasons it kept what it kept. Nothing synthetic wears a real thing&apos;s clothes.
            </p>
          </div>

          <div data-reveal className="mt-14 grid gap-x-8 gap-y-10 sm:grid-cols-3">
            <SieveStep
              label="Seen"
              count={stats.detectionsRaw}
              caption="raw detections — every duck, bench and backpack the cameras noticed"
            />
            <SieveStep
              label="Weighed"
              count={stats.candidates}
              caption="candidate windows scored on dwell, laughter, novelty and named things"
            />
            <SieveStep
              label="Kept"
              count={stats.moments}
              caption="moments rebuilt in 3D, scored to music, pinned to the park"
              accent
            />
          </div>

          <div data-reveal className="mt-14 flex flex-wrap items-center gap-x-2 gap-y-3 text-[13.5px] text-moth">
            <span className="chip chip-live tag text-[11px]">measured</span>
            <span>ran through the real pipeline, while</span>
            <span className="chip chip-synth tag text-[11px]">synthetic</span>
            <span>says so on its face. The discarded candidates stay visible on the bench.</span>
          </div>

          <Link data-reveal href="/detect" className="btn-ghost mt-9 inline-flex px-4 py-2.5 text-[14px]">
            Open the detector bench
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Link>
        </div>
      </section>

      {/* ── V — splats ──────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden py-24 sm:py-32" aria-label="What a splat is">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
          <div>
            <h2 data-reveal className="text-[clamp(2.1rem,4.2vw,3.4rem)] leading-[1.08]">
              A memory is a cloud of light.
            </h2>
            <p data-reveal className="mt-5 max-w-[50ch] text-[15px] leading-relaxed text-moth">
              While it follows, Spark films each kept moment from a dozen angles and rebuilds it
              as a Gaussian splat — millions of tiny lights hanging in space. Not a photo of the
              moment: the moment, still standing there. Walk around it. Find the water bottle you
              left on the bench.
            </p>
            <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={`/walk?m=${moments[0]?.id ?? ""}`} className="btn-ember px-4 py-2.5 text-[14px]">
                Step inside a moment
                <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
              </Link>
              <span className="chip chip-synth tag text-[11px]">preview clouds tonight</span>
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
            <figcaption className="tag mt-3 text-[12px] text-faint">
              Key art, generated for Spark.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── VI — closer ─────────────────────────────────────────────────── */}
      <section className="starfield relative overflow-hidden pb-14 pt-24 sm:pt-32" aria-label="Enter the app">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(50% 40% at 50% 100%, rgb(255 142 94 / 0.12) 0%, rgb(255 142 94 / 0) 72%)",
          }}
        />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-5 text-center">
          <Image
            data-reveal
            src={robotCutout}
            alt="The Spark robot, sitting with two fireflies"
            className="w-52 sm:w-64"
            sizes="256px"
            placeholder="empty"
          />
          <h2 data-reveal className="mt-8 text-[clamp(2.4rem,5vw,4rem)] leading-[1.05]">
            Walk it back.
          </h2>
          <p data-reveal className="mt-5 max-w-[44ch] text-[15px] leading-relaxed text-moth">
            The whole day is pinned to the real park, one light per kept moment. The robot
            remembers where everything is — ask it.
          </p>
          <div data-reveal className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/walk" className="btn-ember px-5 py-2.5 text-[14.5px]">
              Step into the walk
              <ArrowRight size={15} strokeWidth={1.75} aria-hidden />
            </Link>
            <Link href="/detect" className="btn-ghost px-4 py-2.5 text-[14px]">
              Detector bench
            </Link>
          </div>
          <p className="tag mt-20 text-[12px] text-faint">
            Spark · Waterloo Park · 43.4657° N, 80.5322° W · {stats.objects} things remembered
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
  accent = false,
}: {
  label: string;
  count: number;
  caption: string;
  accent?: boolean;
}) {
  return (
    <div className="border-t border-starlight/12 pt-5">
      <p className="tag text-[12px] font-semibold text-faint">{label}</p>
      <p
        className={`tnum font-display mt-3 text-[52px] leading-none ${accent ? "text-gold" : "text-starlight"}`}
        style={{ fontWeight: 480 }}
      >
        <span data-count={count}>{count.toLocaleString("en-CA")}</span>
      </p>
      <p className="mt-3 max-w-[30ch] text-[13px] leading-relaxed text-moth">{caption}</p>
    </div>
  );
}
