---
version: 4
name: Spark-night-walk
description: "NIGHT WALK v4 — a painted park at blue hour you can step into. The product material is light: Gaussian splats are point clouds of captured light, so the whole app lives the hour after sunset. Deep indigo-violet grounds (#0f0d23), warm ember/gold afterglow for action, aurora teal for anything live and measured, six luminous moment inks. The world is ILLUSTRATED: generated storybook paintings (the robot on a lamp-lit path) carry the landing; the day itself is a REAL map — Waterloo Park's actual paths and lake restyled into twilight — with the walk as a ribbon of light and every kept moment a classic teardrop map pin in its ink. The voice is calm and editorial: Fraunces for headlines, Instrument Sans for everything else, quiet sentence-case metadata separated by middle dots. No all-caps telemetry, no brackets, no pills; one small radius scale and exactly two motion curves."
---

Applies to `web/`. Tokens live in `web/app/globals.css` (@theme) and are mirrored for
SVG/canvas/WebGL/MapLibre in `web/lib/theme.ts` — change one, change both. The map style is
generated: `web/scripts/build-map-style.mjs` recolors OpenFreeMap Liberty into
`web/public/map/night-walk.json`; palette changes re-run the script, never hand-edit the JSON.

## The idea

Spark's material IS light, and its world is a storybook. A Gaussian splat is a cloud of
captured light; the walk ended at dusk; the robot's job is to keep the glowing parts of a
day. So the interface is the hour after sunset — a painted park (generated key art: soft
gouache, lamp posts, fireflies, the little robot on the path) for the landing, and the real
park gone indigo for the map. Two things are sacred: the painted-illustration world and the
real twilight tiles. The chrome around them stays quiet, clean and professional so the art
and the map do the talking.

## Colors

Ground (page → raised, all indigo-violet, never gray-black):

- `night` #0f0d23 page · `dusk` #171432 raised sections · `plate` #1f1b40 cards/panels ·
  `haze` #2a2552 wells & hover fills.
- Text on dark: `starlight` #f2eefc primary · `moth` #b5aed6 secondary · `faint` #837daa
  hints/metadata. Body text is always starlight or moth; faint is metadata only, never
  sentences.

Light (the afterglow — warmth and action):

- `ember` #ff8e5e — THE accent. Primary buttons, the route, active states. Scarce elsewhere.
- `gold` #ffc46b — ember's highlight twin; the lit route core, the Kept count.
- `aurora` #3ee6c0 — live/measured semantics only: the follow pulse, measured chips, nav
  goals. Never decoration.

Moment inks (each moment owns one, cycled by index — `MOMENT_INKS` in `lib/theme.ts`):

- ember #ff8e5e · gold #ffc46b · aurora #3ee6c0 · orchid #ee6fae · lilac #9d8bfa · sky #6cc5ff.
- On cards the ink is a small dot beside the metadata line; on the map it fills the pin.
  Ink `glow` washes are for map halos only — never poured over card imagery.

Rules: no pure #fff or #000 anywhere. Gradients exist only as skies inside the paintings and
as edge-binding fades (painting → page ground); NEVER as fills or washes on UI surfaces or
cards.

## Typography

Two families on a real contrast axis — a warm editorial serif against a clean grotesk:

- Display: **Fraunces** variable (optical size on), weight ~480–560, tracking −0.015em,
  sentence case. h1 `clamp(2.7rem, 6vw, 4.75rem)`; section h2 `clamp(2.1rem, 4.2vw, 3.4rem)`.
  Never bolder than 600, never all-caps, never letterspaced.
- UI/body: **Instrument Sans** 400–650, 12–17px. Body 15px `moth` or `starlight`.
- Metadata (`.tag`): Instrument Sans 11–12px, weight 500, sentence case, tabular numerals,
  facts separated by ` · ` — "3:17 p.m. · 59 s · Silver Lake shore". No brackets, no mono,
  no uppercase. Mono is permitted ONLY inside actual code/JSON panels.

## Shape

One radius scale, small: `--radius-sm` 6px (buttons, chips, kbd) · `--radius-md` 10px
(plates, cards, panels) · `--radius-lg` 14px (large media, the takeover stage). Pills are
banned; only status dots and the map's round marks are circles. Plates are crisp: solid fill
+ hairline ring (`--ring`) + indigo shadow. Nested plates are banned.

## Texture & art

- `.starfield` — fine light-speck grain, screen-blended ~0.5 opacity: the night air. Lives
  on the page and dark sections, never on plates.
- Key art — generated paintings (`public/hero/keyart-*.webp`, z_image, soft-gouache
  storybook style). Full-bleed, bound to the page ground with vertical fades at the seams.
  The hero painting opens the site; art sections keep type in the painting's quiet zones
  (open sky, dark foreground).
- Keyframe stand-ins — small painted twilight scenes, always labelled `synthetic`.

## Components

- **Plate**: `plate` fill, hairline ring, 10px radius.
- **Chips**: quiet sentence-case labels in a hairline 6px box. Three semantics, not colors:
  neutral metadata · aurora = measured/live · ember = synthetic/attention. Provenance chips
  are mandatory wherever data could be mistaken for real.
- **Buttons: two, forever.** Filled ember rectangle (dark text, 6px radius) and quiet plate
  rectangle with a hairline ring. Hover is a flat color shift; `active` scales to 0.98. No
  glows, no emboss.
- **Selection** is reverse-video: a square starlight block, night text, radius 0.
- **Map pin**: the classic teardrop, filled with the moment's ink, dark numeral, hairline
  night outline, drop shadow; bottom-anchored. Dimmed to an ink outline until the replay
  reaches it. Hover scales 1.12 from the tip and floats a small plate label.
- **Glass budget**: exactly one frosted element — the walk screen's top-left chrome.
- Icons: lucide-react, `strokeWidth={1.75}`, `currentColor` only. No logo glyph — the
  wordmark is the word "Spark" set in Fraunces.

## Motion

Exactly two curves, registered in CSS and GSAP CustomEase under the same names:

- `--ease-signature` cubic-bezier(0.785, 0.135, 0.15, 0.86) — all UI state, 0.3s.
- `--ease-reveal` cubic-bezier(0.5, 0, 0, 1) — entrances and settles, 0.8–2.4s.

No bounce, no elastic, no third curve. Only `transform` and `opacity` animate. Markup
defaults are the FINAL state — JS animates *from* elsewhere. The landing's motion is
restrained cinema: the hero painting settles (scale 1.07 → 1) on arrival and parallaxes on
scroll, the second painting parallaxes through its window, content reveals once via
IntersectionObserver, numbers count up once. NO pinned scrub sections — every section
scrolls normally and owns its own height, so nothing crops under anything. ≤1024px and
`prefers-reduced-motion` get the complete static page with ambient motion absent, not frozen.

## The map

Real vector tiles (OpenFreeMap Liberty), restyled to twilight by script: ground `night`,
greens as deep indigo-teal, Silver Lake near-black, paths as faint starlight hairlines,
labels dimmed. The trip's park-local metre frame is georeferenced onto the actual park
(`lib/geo.ts`). The walk renders as a two-stroke ribbon — wide ember glow under a crisp gold
line — replaying at 120× with a small gold dot traveling the real odometry. Trailheads are
labelled Start/End badges. The map is the app's floor; quiet chrome floats above it.

## Honesty

Unchanged and non-negotiable: synthetic previews say `synthetic`, discarded candidates stay
visible in the bench, mock telemetry is labelled. Never dress a stand-in as the real thing.
Unknown is rendered as unknown, never as zero.

## Accessibility

WCAG AA on dark: body ≥4.5:1 against `night`/`dusk` (starlight 15.8:1, moth 8.1:1); moment
inks pass ≥3:1 for large/graphic use. Color never the sole carrier — labels ride every ink.
Keyboard: ⌘K palette, tabbable pins and rows, visible focus (2px aurora offset ring). Full
`prefers-reduced-motion` alternatives: replays and reveals land on final state.
