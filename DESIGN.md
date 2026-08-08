---
version: 3
name: Spark-night-walk
description: "NIGHT WALK — a night-sky park poster you can step into. The product material is light: Gaussian splats are point clouds of captured light, so the whole app lives at blue hour. Deep indigo-violet ground (#0f0d23) under fine star grain, a warm ember/gold afterglow for action and warmth, aurora teal for anything live and measured, and six luminous moment inks that glow against the dark. The day is a REAL map — Waterloo Park's actual paths and lake, restyled into twilight — with the walk as a self-drawing ribbon of light and every kept moment a numbered light-marker that expands into its splat. Display type is Archivo Expanded Black; telemetry speaks Martian Mono in brackets: [ 18:42 ] [ MEASURED ] [ SYNTHETIC ]. Motion rides exactly two curves, markup defaults are the final state, and the hero is scroll cinema: the robot's keep-log types itself while drifting splat points converge into the day's route."
---

Applies to `web/`. Tokens live in `web/app/globals.css` (@theme) and are mirrored for
SVG/canvas/WebGL/MapLibre in `web/lib/theme.ts` — change one, change both. The map style is
generated: `web/scripts/build-map-style.mjs` recolors OpenFreeMap Liberty into
`web/public/map/night-walk.json`; palette changes re-run the script, never hand-edit the JSON.

## The idea

Spark's material IS light. A Gaussian splat is a cloud of captured light; the walk ended at
dusk; the robot's job is to keep the glowing parts of a day. So the interface is the hour
after sunset: a real park gone indigo, with everything the robot kept still glowing on it.
Reference lane: NPS night-sky park posters (Tyler Nordgren) — warm poster light against deep
blue dark, never sci-fi, never "mission control."

## Colors

Ground (page → raised, all indigo-violet, never gray-black):

- `night` #0f0d23 page · `dusk` #171432 raised sections · `plate` #1f1b40 cards/panels ·
  `haze` #2a2552 wells & hover fills.
- Text on dark: `starlight` #f2eefc primary · `moth` #b5aed6 secondary · `faint` #8era — see
  globals.css (`#837daa`) hints/disabled. Body text is always starlight or moth; faint is for
  metadata only, never sentences.

Light (the afterglow — warmth and action):

- `ember` #ff8e5e — THE accent. Primary buttons, the route, active states. Scarce elsewhere.
- `gold` #ffc46b — ember's highlight twin; count-ups, star specks, route shimmer.
- `aurora` #3ee6c0 — live/measured semantics only: telemetry, [ MEASURED ] chips, the
  follow-mode pulse. Never decoration.

Moment inks (each moment owns one, cycled by index — `MOMENT_INKS` in `lib/theme.ts`; every
ink carries `glow` (12% alpha wash) and `deep` (pressed/text-on-light) variants):

- ember #ff8e5e · gold #ffc46b · aurora #3ee6c0 · orchid #ee6fae · lilac #9d8bfa · sky #6cc5ff.

Rules: glow marks *data that is alive or kept* — a moment, the route, live telemetry — and is
never applied to chrome. No pure #fff or #000 anywhere, including pasted SVGs. Gradients are
skies and glows (radial, explicit stops), never fills on UI surfaces.

## Typography

- Display: **Archivo** variable, width 125 (Expanded), weight 800–900, tracking −0.02em,
  cap-trimmed (`.trim`). One family across the whole app — contrast comes from width + weight.
- UI/body: **Archivo** width 100, 400–600.
- Telemetry: **Martian Mono** 400–700, 10–13px, uppercase +0.08em, tabular (`.tnum`). The
  bracketed voice — `[ 001 ]`, `[ 18:42:07 ]`, `[ 43.4657° N · 80.5322° W ]`, `[ MEASURED ]`,
  `[ SYNTHETIC ]` — is the identity element; every index, stat and provenance line speaks it.
- Scale has a deliberate hole: nothing between 40px and 76px. A hedged 56px heading is banned.

## Texture

Three inline-SVG data-URI layers (zero network), tuned for dark grounds:

1. `.starfield` — fine film grain (`feTurbulence` 0.85) as *light* specks, screen-blended at
   0.05: the night air. Lives on the page and dark sections, never on plates.
2. Nebula glows — 2–3 radial gradients per hero section (ember/lilac/aurora at 8–14% alpha),
   always behind content.
3. `.mottle` — print mottle for the rare light-ground element (keyframe plates), dark specks.

Texture belongs to the field, not the card. Plates are crisp: solid fill + hairline ring
(`box-shadow: 0 0 0 1px rgb(242 238 252 / 0.14)`), radius from the closed set {0, 14, 999, 50%}.

## Components

- **Plate**: `plate` fill, hairline ring, 14px radius. Nested plates are banned.
- **Chips**: bracketed Martian Mono in a hairline box. Three semantics, not colors: neutral
  metadata · aurora = measured/live · ember = synthetic/attention. Provenance chips are
  mandatory wherever data could be mistaken for real.
- **Buttons: two, forever.** Filled ember pill (night text) and outline starlight pill.
  Embossed hover (inner highlight above, inner shade below); `active` scales to 0.98.
- **Selection** is reverse-video: a square starlight block, night text, radius 0, tight
  around its label. No sliding indicators, no tinted pills.
- **Light-marker** (map pin): a glowing ink disc in a hairline starlight ring with a Martian
  Mono number; outline-only until the replay reaches it; ♪ badge for music.
- **Glass budget**: exactly one frosted element — the atlas top chrome over the map.
- Icons: lucide-react, `strokeWidth={1.5}`, `currentColor` only. No second icon language.

## Motion

Exactly two curves, registered in CSS and GSAP CustomEase under the same names:

- `--ease-signature` cubic-bezier(0.785, 0.135, 0.15, 0.86) — all UI state, 0.3s.
- `--ease-reveal` cubic-bezier(0.5, 0, 0, 1) — entrances and draws, 0.8–0.9s.

No bounce, no elastic, no third curve. Only `transform`, `opacity`, `filter` animate.
Markup defaults are the FINAL state — JS animates *from* elsewhere, so a thrown script or
reduced-motion leaves a finished page, not a blank one. Reveals fire once (`unobserve` on
entry). The hero is scroll cinema (GSAP ScrollTrigger + Lenis): the keep-log types itself,
splat points converge into the route, the route draws itself; ≤1024px and
`prefers-reduced-motion` get the complete static page with ambient motion *absent*, not frozen.

## The map

Real vector tiles (OpenFreeMap Liberty), restyled to twilight by script: ground `night`,
greens as deep indigo-teal, Silver Lake near-black with an aurora rim, paths as faint
starlight hairlines, labels dimmed to `faint`. The trip's park-local metre frame is
georeferenced onto the actual park (`lib/geo.ts`). The walk renders as a two-stroke ribbon —
wide ember glow under a crisp gold line — that draws itself on load and replays at 120× with
the robot marker traveling the real odometry. The map is the app's floor; UI floats above it.

## Honesty

Unchanged and non-negotiable: synthetic previews say `[ SYNTHETIC ]`, discarded candidates
stay visible in the bench, mock telemetry is labelled. Never dress a stand-in as the real
thing. Unknown is rendered as unknown, never as zero.

## Accessibility

WCAG AA on dark: body ≥4.5:1 against `night`/`dusk` (starlight 15.8:1, moth 8.1:1); moment
inks pass ≥3:1 for large/graphic use. Color never the sole carrier — labels ride every ink.
Keyboard: ⌘K palette, tabbable markers and log rows, visible focus (2px aurora offset ring).
Full `prefers-reduced-motion` alternatives: replays and cinema land on final state.
