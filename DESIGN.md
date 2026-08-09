---
version: 5.9
name: Spark-field-notes
description: "FIELD NOTES v5.2 — the robot as a field naturalist, and the site as its journal. Grainy cream paper (#faf4e3), deep pine ink (#16292e), and pressed specimen inks: brass #d5b473, moss #7d7730, clay #cf5e32, lagoon #476d73. One neo-grotesk (Schibsted Grotesk) carries display through UI; a typewriter mono (Fragment Mono) carries the journal's [ BRACKETED ] specimen tags. The landing is scroll cinema: a halftone-dot pine hero with a blur-cycling last line and a ticker of the kept moments, a pinned typeset sieve (the day's noticed words crossed out in ink until six circled entries remain — 'It noticed 9,984 things. It kept six.'), a smeared marquee band into three dark plates that draw their own instruments with honest count-ups and then keep idling (twinkling detections, a marching keep-line, a brass dot lapping the route), a pinned deck of taped-down photographs leafed through one flick at a time, a crossed-out-pages ledger of every discard, a three-line statement with 'Six were.' circled in clay, a numbered field-notes index answered on a taped ruled sheet, and a finale where the pane of glass floats dead-centre over the giant wordmark. An opt-in 'night air' layer (wind + crickets) is synthesized on device. v5.3: the app screens (walk / splat / bench) joined the journal — the walk is a cream survey map generated from the same palette, chrome rides on vellum slips, and the splat stage is the journal's one dark pine plate. v5.4: typographic choreography and honest pins — the hero's lines rise out of per-line masks and the last line rolls through its mask every 3.4s, section h2s split and rise line-by-line (SplitText, blur + fade), the map's numbered circle pins became specimen banners flying each moment's wall clock in its pressed ink (the pressed ink faces are now the journal's own six-ink cycle), the day bar plants wordless miniature pennants with vellum hover slips, NumberChip is a typewriter number circled by the hand-drawn pen ring, and the survey map's greens and water turned up from tinted paper to living moss and wet lagoon. v5.5: the two landings fused — the painted aurora night scene (art-directed plates, live CSS aurora, the sleeping blob companion who IS the start-a-trip button) opens the page under the journal's glass bar, the kept-moments ticker is the seam into the sieve, and the aurora album library folds in as 'The shelf': every album a taped vellum print of its moment thumbs, /library redirecting to /#albums. v5.6: the hero rebuilt as the journal's own layered night — generated riso-print forest planes (keyed tree bands) with fog between them, a real-time shader aurora in lagoon/mist/brass, pointer + scroll parallax by depth, brass fireflies, the blob companion re-inked in journal pigments, and the journal's masked rolling headline back on top; the flagship data moved to Toronto — STACKT Market to the red canoe on street-following odometry. v5.7: the walk snapped to real pedestrian ways (OSM foot-way bake). v5.8–v5.9: two generated hero forests (riso bands, then Bloom-engine sakura) were tried and rejected; the hero reverted to the original painted aurora plates. v6.0: the landing hero left the night for the journal's own paper — the promise typeset dead-centre under a solid pine bar, flanked by two clickable piles of the painted plates mounted as taped photographs (leaf a pile and the top print files itself under the bottom); the aurora scene retired from the landing but kept in the tree."
---

Applies to `web/`. Tokens live in `web/app/globals.css` (@theme) and are mirrored for
SVG/canvas/WebGL/MapLibre in `web/lib/theme.ts` — change one, change both. The map style is
generated: `web/scripts/build-map-style.mjs` recolors OpenFreeMap Liberty into
`web/public/map/field-notes.json` (and keeps `night-walk.json` buildable as the retired
twilight register's revert path); palette changes re-run the script, never hand-edit the JSON.

## The idea

The robot is a field naturalist. It walks a metre behind you, notices everything — ducks,
benches, laughter, golden light — and presses the few minutes worth keeping into a journal.
The whole product IS that journal now: cream paper with real tooth, pressed
teal-and-brass inks, typewriter specimen tags, and a scroll that re-enacts the day's sieve.
The product surface (walk / splat / bench) is the same paper — the walk printed as a
naturalist's survey map, moments stamped as pins in their pressed inks, and the splat
stage framed as the journal's one dark pine plate (the capture keeps the night's light).
One register, one story.

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

NIGHT WALK — retired from product surfaces in v5.3. The indigo tokens stay in the
theme for the generated twilight map's revert path and the landing's own plates. The six
moment inks live on with two faces: `base` (luminous — dark plates, the splat stage) and
`deep` (pressed — pins, chips, meters on paper). v5.4: the pressed faces are no longer
darkened twilight pigments — they ARE the journal's six-ink cycle (clay #c14f24 · lagoon
#476d73 · spruce #2c4347 · brass #8a6d2f · moss #7d7730 · ink #1b1b18, the landing's
PAPER_INKS), so everything stamped on paper speaks the journal's own palette.
Categorical label-family colors mirror the two-face scheme with `FAMILY_COLOR` /
`FAMILY_COLOR_DEEP` in `lib/mock/labels.ts`.

## Typography

- One grotesk everywhere: **Schibsted Grotesk** variable (`--font-grotesk`), 400–700.
  Display weight 500, tracking −0.025em, sentence case. h1 `clamp(2.9rem, 7vw, 6rem)`;
  section h2 `clamp(2.4rem, 5vw, 4rem)`. The giant wordmark and marquee bands may exceed
  the heading scale — they are typographic objects, not headings.
- Specimen tags: **Fragment Mono** (`--font-typewriter`) via `.fnote` — 10.5–13px,
  uppercase, tracking 0.12–0.32em, tabular numerals, brackets written in the markup:
  `[ KEPT · 6 ]`, `[ 002 ]`, `[ WHY SHOW THE DISCARDS? ]`. This is the ONLY uppercase in
  the system, and mono appears nowhere else except real code/JSON panels.
- App screens speak both voices: `.fnote` [ TAGS ] for provenance, timecodes and chips;
  sentence-case `.tag` (dot-separated) for running metadata. Same rule as the landing:
  the brackets are the only uppercase, mono appears nowhere else except real code/JSON
  panels (the bench's Moment JSON prints on a `.plate-pine`).

## Texture

- `.papergrain` — dark-fleck turbulence, multiply-blended: the paper's tooth. Page and
  cream sections; never on top of type-heavy dark plates.
- `.starfield` — light-speck turbulence, screen-blended: the night air on pine grounds
  and dark plates.
- `.dotfield` — a halftone print screen (radial-gradient dots, center-masked) on pine
  heroes. Print, not sci-fi.
- `.gridfield` — graph-paper hairlines on cream sections (the journal's squared pages),
  edge-masked so it reads as a page, not a spreadsheet. The paper counterpart of the
  hero's dotfield; every major cream section wears it over `.papergrain`.
- Tactile props, used sparingly and only on the journal: `.tape` (translucent
  torn-ended strips holding prints and sheets down), `.ruled` (28px feint lines the
  field-note answers are written on), `.stamp` (a bordered mono chip pressed at an
  angle, clay).

## Shape & components

- Radius scale, sharpened in v5.8: 3/5/8px for boxes, and the "pills" are cut to the
  same edge (`border-radius: var(--radius-md)`) — nothing is fully round now except
  status dots. The journal's corners are cut, not rounded. `.pill-brass` (brass fill,
  ink text) is still the primary action; `.pill-ghost` (hairline ring via currentColor —
  set a text color on the element, never a `color` in the class) is the quiet one.
- Chrome dissolves into the page wherever the ground allows it (v5.8): the walk's title
  block is survey lettering laid ON the map (milk-halo text riding the camera's pitch
  and bearing — see GroundPlate in FieldMap), the globe plate's masthead is set straight
  into the paper, and the hint slips ("every pin is a kept moment", "drag to turn") are
  gone — the marks explain themselves. Cards remain only where a surface is doing work:
  the day bar, the gazetteer, hover slips. The Phone/Web demo toggle is retired.
- App surfaces: `.plate-vellum` (vellum fill + `--ring-ink` pen line + soft ink shadow)
  is the raised card; `.plate-pine` is the one dark plate (splat stage, code panels);
  `.scrub-paper` is the brass-bead scrubber; `.selected-block` is reverse-video ink.
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
2. **The hero** (v6.0 — the album lies open) — a whole page of the journal, on
   paper: the promise typeset dead-centre ("A day, remembered / in light." —
   each line rising from its own overflow mask, the last line rolling through
   the mask every 3.4s), flanked by two piles of the walk's painted plates
   mounted as photographs — vellum mats, torn tape, an fnote caption and wall
   clock lettered on each mat. Each pile is one `<button>`: clicking leafs it,
   the top print slipping outward off the desk and filing itself under the
   bottom while CSS transitions (depth-indexed transforms, `--ease-signature`)
   settle the rest of the pile. Landscape prints stack left, portrait crops
   right — three plates yield six photographs via `object-position` windows.
   Below `lg` the piles tuck side by side under the promise, captionless. The
   header over it is solid pine, edge to edge — glass read as fading at the
   sides over the cream page. The hero hands off through the kept-moments
   ticker — a pine seam strip — into the sieve (`#journal`). The aurora night
   scene (v5.5–v5.9, `components/hero/LandingHero.tsx` + `HeroSky` + the blob
   button) is retired from the landing but kept intact in the tree. Section
   h2s reveal via `[data-lines]`: SplitText (after `document.fonts.ready`)
   splits them into lines that rise staggered with blur + fade — no masks, so
   tight leading keeps its descenders. Deep links into the pinned page
   re-anchor on the first ScrollTrigger refresh.
3. **Marquee bands** — CSS `marquee`/`marquee-track-reverse`, edge-masked; alternate
   copies wear `.smear` (blur 7px) for the smeared-ink read.
4. **The gallery deck** — "Six moments, kept." pins on desktop as a pile of
   taped-down prints in the hand: each scroll beat flicks the top one off the pile
   (alternating left/right, tossed behind the entry text) while the journal entry
   beside it swaps and a brass rail fills. The deck exists only once motion JS arms
   (`html.reveal-armed` swaps `.deck-when-armed`/`.strip-when-armed` at ≥1025px);
   mobile, tablet, no-JS and reduced motion keep the native horizontal strip of the
   same mounted prints.
5. **The plates draw themselves** on arrival, then idle: detection dots ripple out and
   the hot ones twinkle; score bars grow against the clay keep-line whose dashes then
   march while the kept bars glow; six pennant flags in the luminous inks drop onto
   the dotted route, breathe sonar rings, and a brass dot — the robot — laps the evening.
6. **The statement** — three stacked lines that each FIT the page ("Not every minute /
   is worth keeping. / Six were."), drifting a few percent in opposite directions as
   the section passes — always readable, never driven off the edge. "Six were." wears
   a clay circle that draws itself on reveal (same [data-draw] grammar as the sieve).
7. Reveals via IntersectionObserver once (variants: up/fade/scale/left/right with
   per-item `--reveal-delay`); ledger score bars grow in; count-ups once to the real
   number. The field notes are a numbered index — selecting an entry circles its
   number in clay (CSS-transitioned dashoffset, `aria-expanded`-driven so the first
   entry arrives circled without JS) and swaps the taped, ruled, stamped answer sheet.
   **The shelf** (`#albums`, v5.5) follows: every album as a taped vellum print — a
   2×2 collage of its moment thumbs (odd counts promote the first print to
   full-width), typewriter index + date on the mat, title and stats below, linking
   to `/trip/[id]`. The aurora library page retired into it (`/library` redirects
   to `/#albums`); the aurora scene and album components live on under
   `components/hero` and `components/album`.
8. **Night air** — opt-in ambient audio (brown-noise wind through a wandering lowpass,
   sparse cricket chirps), synthesized in Web Audio, toggled in the nav.

Lenis smooth scroll is desktop-only, and because html/body are height:100% its
ResizeObserver can't see the page grow — `lenis.resize()` re-runs on every
ScrollTrigger refresh so pin spacers never leave the scroll limit stale.
`prefers-reduced-motion` gets the complete static page — the sieve resting on its
crossed-out page, marquees still, numbers already true.

## The map

Real OpenFreeMap Liberty tiles restyled by script into the journal's own survey map:
cream ground a half-step under the page, LIVING moss greens (#d3dd9a, wood #bcd08f) and
a real wet lagoon (#a4d0c6, edge #6fa89c) — v5.4 turned both up from tinted-paper washes
so the park reads alive — vellum roads with fine sand casings, ink-soft labels, extrusion
light flattened so buildings print as pale blocks. The walk draws as the journal marks a
keeper — a DOTTED clay pen line over a soft brass highlighter bleed — replayed at 120×
while the full route waits as a pencil trace. The flagship route itself (v5.7) is SNAPPED
to real pedestrian ways — OSM foot-way data baked through Dijkstra into
`lib/mock/trips/stackt-route.gen.ts` — so the drawn walk keeps to sidewalks, signalled
crossings, park paths and the waterfront trail, wandering within the walkable corridor
(±1 m weave) and across park grass, never through buildings, traffic lanes or the rail
corridor. Kept moments are specimen banners planted
where the minute was kept: contact shadow, fine ink stem, and a small swallow-tailed
banner (clip-path, −2.5° lean at rest) flying the moment's wall clock in milk typewriter
on its pressed ink; hot banners straighten, lift and breathe a sonar ring at the hoist,
and banners the replay hasn't reached print hollow (vellum inlay, ink text). Numbered
circle heads are retired — the clock IS the label, and `NumberChip` everywhere is now a
typewriter number circled by the landing's hand-drawn pen ring (clay, or the moment's
pressed ink). Trailheads are benchmark rings; the scale bar speaks fnote; papergrain and
a soft ink vignette sit over the tiles so the map reads as a page. The day bar is the
same instrument in miniature: a pen-line rail with quarter-hour ticks, a brass fill to
the playhead with a clay nib riding its edge (breathing while the replay runs), and the
moments planted on the rail as wordless miniature pennants at their true time of day —
hovering one lifts a vellum slip with its clock and title.

**The weather** (`components/atlas/CloudLayer.tsx`): a dozen-odd cumulus drift over the
map on one pointer-transparent canvas, anchored to the WORLD — re-projected through the
live map transform every frame, so they pan and scale with the ground. Zoomed out you are
above them (white sprites, faint shadows); zoomed in you are beneath them and only their
ink shadows stay pressed on the ground, offset to the south-east and squashed by the
camera pitch. Sprites are pre-rendered gaussian-puff canvases; reduced motion stops the
wind but keeps the sky.

**The desk globe** (v5.8, `components/atlas/{PocketGlobe,GlobeOverlay,paperGlobe}.tsx`):
the map carries its own instrument — a brass-ringed pocket globe idling at a slow turn
in the walk's corner (no label; the instrument is the label), every walk's origin
dotted in clay. Clicking it opens the globe plate: the Earth printed in the survey
map's own plates — cream ground and wet-lagoon water read straight off the landmask by
the occluder sphere's shader, so the globe and the map are unmistakably one atlas —
with the land stippled over it in pine ink (the splat stage's fibonacci-sphere,
distance-to-coast point machinery at ~110k jittered samples; coasts press hard,
interiors carry the map's wood-green in deepened dots; no day/night terminator, ink has
no night side), a fresnel limb shaded in ink the way an engraver darkens a plate's
edge, a brass equator with 24 meridian ticks, and a dotted brass expedition line
hopping the walks in the order they were walked. Every walk is planted as the map's own
swallow-tailed specimen banner (DOM, pressed-ink cycle by pin, −2.5° lean, straightens
when hot) flying the walk's date at CONSTANT screen size — flying closer changes the
ground, never the lettering, exactly as the map's banners hold their size through zoom.
The open walk's banner breathes the sonar ring. A vellum gazetteer rail on the left is
the keyboard interface and a second rendering of the pin list. Clicking a banner or row
flies the camera (nlerp on direction — never through the planet), dives to just above
the surface while a paper wash rises, and lands in that walk's survey map: the open
walk simply closes the plate; any other walk navigates to `/walk?trip=<id>` — the walk
screen is multi-trip now, georeferenced from each trip's own origin.

## Honesty

Unchanged and non-negotiable — and now a landing feature: the [ DISCARDED ] shelf shows
every rejected candidate with its trigger, score bar and the exact reason it lost. The
WEIGHED plate draws one bar per real candidate with exactly the kept count above the line.
Synthetic previews say `synthetic`; unknown renders as unknown, never as zero.

## Accessibility

WCAG AA both registers. On paper: ink 16.6:1, ink-soft 7.1:1, ink-faint metadata-only.
On pine: milk 14.9:1, mist 7.4:1. Brass and clay are large-text/graphic only on their
grounds. Color never the sole carrier — every ink rides with a label. Keyboard: tabbable
pills, tabs and accordion buttons; focus is a 2px clay ring everywhere — the app included.
Full `prefers-reduced-motion` alternatives: everything lands on final state.
