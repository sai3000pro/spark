---
version: 5.2
name: Spark-field-notes
description: "FIELD NOTES v5.2 — the robot as a field naturalist, and the site as its journal. Grainy cream paper (#faf4e3), deep pine ink (#16292e), and pressed specimen inks: brass #d5b473, moss #7d7730, clay #cf5e32, lagoon #476d73. One neo-grotesk (Schibsted Grotesk) carries display through UI; a typewriter mono (Fragment Mono) carries the journal's [ BRACKETED ] specimen tags. The landing is scroll cinema: a halftone-dot pine hero with a blur-cycling last line and a ticker of the kept moments, a pinned typeset sieve (the day's noticed words crossed out in ink until six circled entries remain — 'It noticed 9,984 things. It kept six.'), a smeared marquee band into three dark plates that draw their own instruments with honest count-ups, a pinned horizontal gallery of the six kept moments, a crossed-out-pages ledger of every discard, a scroll-dragged statement, an accordion of field notes, and a finale where the giant wordmark bleeds off the page behind one pane of glass. An opt-in 'night air' layer (wind + crickets) is synthesized on device. The walk/trip/bench app screens keep the NIGHT WALK twilight map — the walk itself still happens after sunset."
---

Applies to `web/`. Tokens live in `web/app/globals.css` (@theme) and are mirrored for
SVG/canvas/WebGL/MapLibre in `web/lib/theme.ts` — change one, change both. The map style is
generated: `web/scripts/build-map-style.mjs` recolors OpenFreeMap Liberty into
`web/public/map/night-walk.json`; palette changes re-run the script, never hand-edit the JSON.

## The idea

The robot is a field naturalist. It walks a metre behind you, notices everything — ducks,
benches, laughter, golden light — and presses the few minutes worth keeping into a journal.
The brand surface (the landing) IS that journal: cream paper with real tooth, pressed
teal-and-brass inks, typewriter specimen tags, and a scroll that re-enacts the day's sieve.
The product surface (walk / trip / bench) stays the NIGHT WALK twilight map — the journal
is how the day is told; the map is where the day lives. Two registers, one story.

## Colors

FIELD NOTES (landing + brand surfaces):

- Paper: `paper` #faf4e3 page · `vellum` #fffbf0 raised cards. Both wear `.papergrain`.
- Ink text on paper: `ink` #1b1b18 primary · `ink-soft` #52524a secondary ·
  `ink-faint` #78786c metadata only, never sentences.
- Pressed inks: `pine` #16292e (dark grounds) · `spruce` #2c4347 (dark plates) ·
  `lagoon` #476d73 · `brass` #d5b473 (THE accent: pills, keep-counts, gold moments) ·
  `moss` #7d7730 · `clay` #cf5e32 (attention: discards, the wordmark's dot, focus rings).
- Text on pine: `milk` #f6f0df primary · `mist` #a9bdb9 secondary.
- Gradients exist only as the pine→paper section bleed; never as fills on cards or text.

NIGHT WALK (walk / trip / bench app screens) — unchanged: `night`/`dusk`/`plate`/`haze`
grounds, `starlight`/`moth`/`faint` text, ember/gold/aurora semantics, six moment inks.
The generated map style still derives from these values.

## Typography

- One grotesk everywhere: **Schibsted Grotesk** variable (`--font-grotesk`), 400–700.
  Display weight 500, tracking −0.025em, sentence case. h1 `clamp(2.9rem, 7vw, 6rem)`;
  section h2 `clamp(2.4rem, 5vw, 4rem)`. The giant wordmark and marquee bands may exceed
  the heading scale — they are typographic objects, not headings.
- Specimen tags: **Fragment Mono** (`--font-typewriter`) via `.fnote` — 10.5–13px,
  uppercase, tracking 0.12–0.32em, tabular numerals, brackets written in the markup:
  `[ KEPT · 6 ]`, `[ 002 ]`, `[ WHY SHOW THE DISCARDS? ]`. This is the ONLY uppercase in
  the system, and mono appears nowhere else except real code/JSON panels.
- App screens keep sentence-case `.tag` metadata separated by middle dots.

## Texture

- `.papergrain` — dark-fleck turbulence, multiply-blended: the paper's tooth. Page and
  cream sections; never on top of type-heavy dark plates.
- `.starfield` — light-speck turbulence, screen-blended: the night air on pine grounds
  and dark plates.
- `.dotfield` — a halftone print screen (radial-gradient dots, center-masked) on pine
  heroes. Print, not sci-fi.

## Shape & components

- Radius scale: 6/10/14px for boxes — plus **pills** (`rounded-full`), which are the ONLY
  fully-round controls and belong to the journal: `.pill-brass` (brass fill, ink text) is
  the primary action; `.pill-ghost` (hairline ring via currentColor — set a text color on
  the element, never a `color` in the class) is the quiet one. App screens keep their two
  rectangle buttons.
- Vellum cards: `vellum` fill + inset hairline ring + soft ink shadow. Nested cards banned.
- `.glass-bar` — the journal's ONE pane of glass, used twice: sticky nav and the finale
  footer. Tint deep enough that milk text reads over cream sections.
- Segmented mono toggle (KEPT/DISCARDED): vellum track, spruce active thumb.
- Icons: lucide-react, `strokeWidth={1.75}` (2 for pill plus-glyphs), `currentColor`.

## Motion

Exactly two curves, registered in CSS and GSAP CustomEase under the same names:

- `--ease-signature` cubic-bezier(0.785, 0.135, 0.15, 0.86) — UI state, 0.3s.
- `--ease-reveal` cubic-bezier(0.5, 0, 0, 1) — entrances and settles, 0.5–1.4s.

Markup defaults are the FINAL state — JS animates *from* elsewhere. The landing's
choreography, in order:

1. **The sieve** — the one pinned scrub section (≈260%): the day's noticed words typeset
   as one block on paper; a pen crosses them out in shuffled order while the caption
   changes overhead ("It noticed N things." → "It weighed 15 of its minutes." → "It kept
   six."), and six words get circled in their moment's ink with its clock. No-JS and
   reduced-motion land directly on the final crossed-out page.
2. **Hero cycle** — the headline's last line blurs out/in every 3.4s (wet ink).
3. **Marquee bands** — CSS `marquee`/`marquee-track-reverse`, edge-masked; alternate
   copies wear `.smear` (blur 7px) for the smeared-ink read.
4. **The gallery** — "Six moments, kept." pins on desktop and scrubs horizontally with
   the evening's rail beneath; mobile and no-JS get native overflow scroll.
5. **The plates draw themselves** on arrival: detection dots ripple out from center,
   score bars grow against the clay keep-line, pins drop onto the route.
6. **The dragged statement** — one giant line scrubbed `xPercent` across its section.
7. Reveals via IntersectionObserver once (variants: up/fade/scale/left/right with
   per-item `--reveal-delay`); ledger score bars grow in; count-ups once to the real
   number.
8. **Night air** — opt-in ambient audio (brown-noise wind through a wandering lowpass,
   sparse cricket chirps), synthesized in Web Audio, toggled in the nav.

Lenis smooth scroll is desktop-only. `prefers-reduced-motion` gets the complete static
page — the sieve resting on its crossed-out page, marquees still, numbers already true.

## The map

Unchanged from v4: real OpenFreeMap Liberty tiles restyled to twilight by script, the walk
as a two-stroke ember/gold ribbon replayed at 120×, teardrop pins in moment inks.

## Honesty

Unchanged and non-negotiable — and now a landing feature: the [ DISCARDED ] shelf shows
every rejected candidate with its trigger, score bar and the exact reason it lost. The
WEIGHED plate draws one bar per real candidate with exactly the kept count above the line.
Synthetic previews say `synthetic`; unknown renders as unknown, never as zero.

## Accessibility

WCAG AA both registers. On paper: ink 16.6:1, ink-soft 7.1:1, ink-faint metadata-only.
On pine: milk 14.9:1, mist 7.4:1. Brass and clay are large-text/graphic only on their
grounds. Color never the sole carrier — every ink rides with a label. Keyboard: tabbable
pills, tabs and accordion buttons; focus is a 2px clay ring on the journal, aurora in the
app. Full `prefers-reduced-motion` alternatives: everything lands on final state.
