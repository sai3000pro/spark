/**
 * "There is more below."
 *
 * A link INTO the album now that the library is its own route (/album) rather
 * than a section stacked under the hero. Still a plain <a>, not next/link — it
 * works before hydration and with JS disabled, is focusable and
 * Enter-activatable for free, and middle-clicks. It is a CHILD of the hero
 * rather than fixed, so it scrolls away by itself: no scroll listener, no fade
 * logic.
 *
 * The label is deliberate. A naked bouncing chevron is the default generated
 * landing-page gesture; naming the destination is most of what makes it read as
 * designed. It is fog-grey rather than brand orange because the blob above it is
 * the page's only primary, and a second orange thing 200px below would compete.
 */
export function ScrollCue() {
  return (
    <a
      href="/album"
      aria-label="Open your album"
      className="hero-cue group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
    >
      <span className="eyebrow transition-colors group-hover:text-fog-200">Albums</span>
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
