/**
 * The three things the hero promises, said once, between the scene and the library.
 *
 * WHY IT EXISTS. The lede makes three specific claims — it picks the music, it
 * remembers where your things are, it captures places you can step back into —
 * and before this section the page answered none of them. You went straight from
 * a promise to a grid of album covers, and the only explanation of the product
 * was a sentence in 13px type over a photograph. A visitor who has never heard of
 * Spark had nothing to read.
 *
 * ── HAIRLINES, NOT CARDS ────────────────────────────────────────────────────
 * Three panels with backgrounds and rounded corners is the generated-UI feature
 * grid, and this codebase already argues against it in TripSessionCard: a boxed
 * panel makes a claim about importance that three sibling paragraphs do not.
 * These are three columns separated by the same hairline the page uses at the
 * hero seam, so the section reads as a spread rather than as a dashboard.
 *
 * The mono numeral in a bordered box is lifted deliberately from the pipeline
 * counters in TripSessionCard — the app already numbers its stages that way, and
 * reusing it means the section is furnished from the design system rather than
 * inventing a fourth way to show an index.
 *
 * Server component. The motion is scroll-driven CSS with no JS at all — see
 * `.lift` in globals.css, and the note there about why a scroll timeline rather
 * than the IntersectionObserver the album grid uses.
 */

interface Beat {
  n: string;
  title: string;
  body: string;
}

/**
 * Written to be READ, not skimmed as headings.
 *
 * Each beat leads with the concrete thing rather than the capability noun —
 * "your keys went down on the picnic table" rather than "object persistence".
 * The vocabulary is the app's own: a TRIP is the act, an ALBUM is what it
 * leaves behind, and neither is called a session or a journey here.
 */
const BEATS: Beat[] = [
  {
    n: "01",
    title: "It picks the music",
    body: "Spark reads where you are and who you are with, and puts on something that fits. You never open an app, and you never ask.",
  },
  {
    n: "02",
    title: "It knows where you left things",
    body: "It watched your keys go down on the picnic table, and it was still watching when you walked off without them. Ask it later and it will tell you.",
  },
  {
    n: "03",
    title: "It keeps the moments worth keeping",
    body: "Not photographs — places. The ones it decides mattered come back as rooms you can move around inside, long after the day is over.",
  },
];

export function WhatItDoes() {
  return (
    <section
      id="what"
      // tabIndex={-1} for the same reason the library section carries it: this
      // is now the scroll cue's destination, and without it the cue moves the
      // VIEWPORT but leaves keyboard focus back in the hero — so the next Tab
      // throws you to the top of the page. That is the classic broken skip link,
      // and retargeting the cue here is exactly what would have introduced it.
      tabIndex={-1}
      // scroll-mt clears the app bar, which is 60px and sticky; matches the
      // offset the library uses so both jumps land the same way.
      className="scroll-mt-20 border-t border-white/[0.06] outline-none"
    >
      <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-14 sm:px-5 sm:pb-20 sm:pt-20">
        <header className="lift max-w-[46ch]">
          <p className="eyebrow">While you get on with your day</p>
          <h2 className="mt-1.5 font-display text-[22px] font-semibold leading-tight tracking-[-0.015em] text-fog-100 sm:text-[26px]">
            Spark is doing three things behind you.
          </h2>
        </header>

        {/*
          `divide-x` draws the rule BETWEEN columns only, so there is no trailing
          hairline hanging off the last one. It is suppressed below md, where the
          columns stack and a vertical rule between them would be nonsense — the
          horizontal divide takes over instead.
        */}
        <div className="mt-9 grid gap-px divide-y divide-white/[0.06] md:grid-cols-3 md:divide-x md:divide-y-0">
          {BEATS.map((beat, i) => (
            <article
              key={beat.n}
              className="lift py-6 md:px-6 md:py-0 md:first:pl-0 md:last:pr-0"
              // Each column starts its rise a little later than the one before
              // it. This is a scroll OFFSET, not a delay: it staggers identically
              // whichever way you are scrolling, which a time-based delay does
              // not. See `.lift` in globals.css.
              style={{ "--lift-start": `${6 + i * 7}%` } as React.CSSProperties}
            >
              <span className="inline-block rounded border border-ink-600 px-1 font-mono text-[10px] tracking-[0.14em] text-machine-400">
                {beat.n}
              </span>
              <h3 className="mt-3 font-display text-[16px] font-semibold leading-snug text-fog-100">
                {beat.title}
              </h3>
              <p className="mt-2 max-w-[38ch] text-[13px] leading-relaxed text-fog-400">
                {beat.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
