/**
 * "There is more below."
 *
 * A plain <a href="#albums">, not next/link — this is a same-page jump, and
 * routing it through the App Router would be a navigation. As an anchor it works
 * before hydration and with JS disabled, is focusable and Enter-activatable for
 * free, middle-clicks, and moves keyboard focus to the target section.
 *
 * It is a CHILD of the hero rather than fixed, so it scrolls away by itself.
 * That removes the entire question of "when does it hide" — no scroll listener,
 * no state, no fade logic.
 *
 * The label is deliberate. A naked bouncing chevron is the default generated
 * landing-page gesture; naming the destination is most of what makes it read as
 * designed. It is fog-grey rather than brand orange because the blob above it is
 * the page's only primary, and a second orange thing 200px below would compete.
 *
 * The destination is a PROP because the page grew a section between the hero and
 * the library. A cue that still said "Albums" would now skip the explanation of
 * the product entirely — it would scroll you past the answer to the question the
 * headline just raised.
 */
export function ScrollCue({
  href = "#what",
  label = "What it does",
  /** Screen-reader phrasing, which wants a verb the visible label does not. */
  description = "Skip to what Spark does",
}: {
  href?: string;
  label?: string;
  description?: string;
}) {
  return (
    <a
      href={href}
      aria-label={description}
      className="hero-cue group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
    >
      <span className="eyebrow transition-colors group-hover:text-fog-200">{label}</span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden
        className="hero-cue__chevron"
      >
        {/* Same 1.75 round-capped stroke as PageHeader's back chevron, so the
            two share one drawing language. */}
        <path
          d="M4 6L8 10.5L12 6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}
