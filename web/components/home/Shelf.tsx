"use client";

/**
 * Section VIII — the shelf: everything you have captured, and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACED, AND WHY IT IS ITS OWN FILE
 *
 * The shelf used to map `listAllTrips()` — the nine authored walks in
 * lib/mock/trips — under the heading "every album the robot has pressed". On a
 * machine that had never recorded or uploaded anything, that is nine dated
 * walks through Lisbon, Kyoto and Cape Town presented as the reader's own, each
 * card opening a real page that made the claim stick. It now reads
 * lib/library.ts, which knows only about things that actually happened here.
 *
 * Which means this section has two states, and the second is the common one:
 * a brand-new install has nothing, and the shelf has to say so and then be
 * useful about it. Lifted out of Landing.tsx because that file is a 2,000-line
 * scroll choreography and the empty state is prose and three links — putting it
 * inline would bury the one part of this page a first-time reader ever sees.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THE DEMO WENT
 *
 * Sections I–VII of the landing narrate ONE authored evening — the STACKT
 * Market walk — and they are kept, LABELLED, rather than removed. The argument:
 * those sections are not a feed, they are a worked example of how the scorer
 * decides, down to every candidate it threw away and why. Deleting the walk
 * they are built on would not leave an honest landing page, it would leave an
 * empty one, and a product whose entire claim is "it decides for you" has to be
 * able to show one decision end to end. What was NOT defensible was this shelf,
 * because a shelf is a claim of possession and nothing else. So the demo stays
 * where it explains something and is marked as a demo; the shelf holds only
 * what is yours, and links out to the demo walks rather than absorbing them.
 *
 * The animation contract is Landing.tsx's: `data-reveal` and `data-lines` are
 * collected by a querySelectorAll from the page root, so markup here is the
 * FINAL state and no-JS gets a complete, readable section.
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { KeyframeImg } from "@/components/system/ui";
import { shortDate } from "@/lib/format";
import type { CaptureCard, CaptureKind } from "@/lib/library";

/** The tag stamped on a card, so a route is never mistaken for a walk. */
const KIND_LABEL: Record<CaptureKind, string> = {
  walk: "WALK",
  album: "ALBUM",
  journey: "JOURNEY",
  splat: "SPLAT",
};

export function Shelf({ captures }: { captures: CaptureCard[] }) {
  return (
    <section
      id="albums"
      tabIndex={-1}
      className="papergrain gridfield relative border-t border-ink/10 bg-paper py-20 outline-none sm:py-24"
      aria-label="Everything you have captured"
    >
      <div className="relative mx-auto max-w-6xl px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 data-lines className="text-[clamp(2rem,4.2vw,3.2rem)] leading-[1.06] text-spruce">
            Your shelf.
          </h2>
          <p data-reveal className="fnote pb-2 text-[11px] text-ink-faint">
            {captures.length === 0
              ? "[ NOTHING PRESSED YET ]"
              : `[ ${captures.length} ${captures.length === 1 ? "CAPTURE" : "CAPTURES"} · YOURS, ON THIS MACHINE ]`}
          </p>
        </div>

        {captures.length === 0 ? <EmptyShelf /> : <ShelfGrid captures={captures} />}

        {/* The one place the authored walks are named, and named as what they
            are. Below the fold of the shelf on purpose: someone with real
            captures should see theirs first, and someone with none should be
            pointed at recording before being pointed at a demo. */}
        <p data-reveal className="mt-14 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-faint">
          The evening told above is a demo walk, not one of yours — nine authored
          walks ship with Spark so the scorer has something to be shown deciding
          on.{" "}
          <Link href="/trip" className="link-pen text-ink-soft">
            They are all here
          </Link>
          , and they never appear on this shelf.
        </p>
      </div>
    </section>
  );
}

/* ── Something to show ──────────────────────────────────────────────────── */

function ShelfGrid({ captures }: { captures: CaptureCard[] }) {
  return (
    <div className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
      {captures.map((c, i) => {
        const tilt = [-0.9, 0.7, -0.5, 0.9, -0.7, 0.5, -0.8][i % 7];
        return (
          <Link
            key={`${c.kind}:${c.id}`}
            href={c.href}
            data-reveal
            style={
              {
                "--reveal-delay": `${(i % 3) * 90}ms`,
                "--tilt": `${tilt}deg`,
              } as React.CSSProperties
            }
            className="group block"
          >
            <article className="relative">
              <div className="papergrain relative rotate-[var(--tilt)] bg-vellum p-3 shadow-[0_2px_4px_rgb(27_27_24_/_0.08),0_24px_44px_-24px_rgb(27_27_24_/_0.5)] transition-transform duration-500 ease-(--ease-reveal) group-hover:-translate-y-2 group-hover:rotate-0">
                <span aria-hidden className="tape -top-2.5 left-6 -rotate-5" />
                <span aria-hidden className="tape -top-2.5 right-8 rotate-3" />
                <CardPlate card={c} />
                <div className="flex items-baseline justify-between pt-2.5">
                  <p className="fnote text-[10px] text-ink-faint">[ {KIND_LABEL[c.kind]} ]</p>
                  <p className="fnote text-[10px] text-ink-faint">{shortDate(c.at)}</p>
                </div>
              </div>
              <div className="mt-4 px-1">
                <h3 className="flex items-baseline gap-2 text-[21px] leading-snug text-ink">
                  {c.title}
                  <ArrowUpRight
                    size={15}
                    strokeWidth={2}
                    className="shrink-0 translate-y-[2px] text-brass-deep transition-transform duration-300 ease-(--ease-signature) group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </h3>
                <p className="tag mt-1 text-[12.5px] text-ink-soft">{c.detail}</p>
                {/* The caveat, when the store that owns this thing has one.
                    Same weight as the date rather than hidden behind a hover:
                    "we do not know where this was" is not a footnote to the
                    card, it is half of what the card says. */}
                {c.note ? (
                  <p className="mt-1.5 max-w-[46ch] text-[12px] leading-relaxed text-ink-faint">
                    {c.note}
                  </p>
                ) : null}
              </div>
            </article>
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Why a card can have no picture, per kind.
 *
 * Four different facts, and the first draft of this component printed the splat
 * sentence for all of them — a clip the scorer kept nothing from came back
 * captioned "a reconstruction with no frames behind it", which is not what
 * happened to it and not even the right kind of thing. So the blank plate is
 * keyed on what the card IS, and every branch is a sentence someone could check.
 */
const BLANK_PLATE: Record<CaptureKind, { marker: string; line: string }> = {
  splat: {
    marker: "[ .PLY ON DISK ]",
    line: "A reconstruction with no frames behind it.",
  },
  walk: {
    marker: "[ NOTHING KEPT ]",
    line: "The scorer found no minute in this clip worth keeping.",
  },
  journey: {
    marker: "[ NO WALK YET ]",
    line: "A route, laid out. None of its clips has been through the detector.",
  },
  album: {
    marker: "[ NO FRAMES YET ]",
    line: "Filed, but nothing in it has a kept moment to show.",
  },
};

/**
 * The picture on the card, or the honest absence of one.
 *
 * A generated placeholder collage reads as "here are some frames from it", so a
 * capture with no frames gets words instead of pictures rather than a prettier
 * lie about what is inside it.
 */
function CardPlate({ card }: { card: CaptureCard }) {
  if (card.thumbs.length === 0) {
    const blank = BLANK_PLATE[card.kind];
    return (
      <div className="flex aspect-[4/3] flex-col justify-end bg-paper p-4">
        <p className="fnote text-[10px] text-ink-faint">{blank.marker}</p>
        <p className="mt-1.5 text-[13.5px] leading-snug text-ink-soft">{blank.line}</p>
      </div>
    );
  }

  return (
    // Odd counts still fill the mat: with 1 or 3 prints the first goes
    // full-width, so the collage never shows a bare quadrant.
    <div className="grid grid-cols-2 gap-1 overflow-hidden">
      {card.thumbs.slice(0, 4).map((th, k, arr) => {
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
  );
}

/* ── Nothing to show ────────────────────────────────────────────────────── */

/**
 * The three ways something gets onto this shelf, in the order they cost effort.
 *
 * Each sentence is what the corresponding panel on `/live` can really do today,
 * copied from the same honesty its own screen keeps — there is no rover here,
 * so the first one says there is no rover here. A first-run state that promised
 * a robot would be the one place on this page still overstating.
 */
const FIRST_STEPS = [
  {
    n: "01",
    title: "Send a walk in from a rover",
    body:
      "A rover carries the camera and Spark counts what it sees. Nothing is driving one yet — connect one and the session opens by itself.",
    href: "/live",
    cta: "Open the live screen",
  },
  {
    n: "02",
    title: "Bring footage you already have",
    body:
      "Drop in a video and a real detector runs over its real frames, in this tab. What it keeps and what it throws away both go on the record. One clip is a walk; several become a journey with the route worked out between them.",
    href: "/live",
    cta: "Bring a video",
  },
  {
    n: "03",
    title: "Bring a splat you already built",
    body:
      "If something has already been reconstructed, hand over the .ply and it becomes a capture with a page of its own. No walk is invented around it.",
    href: "/live",
    cta: "Bring a .ply",
  },
];

function EmptyShelf() {
  return (
    <div className="mt-10">
      <p data-reveal className="max-w-[54ch] text-[16px] leading-relaxed text-ink-soft sm:text-[17px]">
        Spark has not kept anything for you yet. This shelf fills up on its own
        once something has been through the pipeline — until then it is honestly
        empty.
      </p>

      <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {FIRST_STEPS.map((step, i) => (
          <div
            key={step.n}
            data-reveal
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
            className="plate-vellum flex flex-col p-5"
          >
            <p className="fnote text-[10px] text-ink-faint">[ {step.n} ]</p>
            <h3 className="mt-2 text-[19px] leading-snug text-ink">{step.title}</h3>
            <p className="mt-2 flex-1 text-[13.5px] leading-relaxed text-ink-soft">{step.body}</p>
            <Link
              href={step.href}
              className="pill-ghost mt-5 w-fit px-4 py-2 text-[13px] text-ink"
            >
              {step.cta}
              <ArrowUpRight size={14} strokeWidth={2} aria-hidden />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
