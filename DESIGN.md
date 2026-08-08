---
version: 2
name: Spark-riso-atlas
description: "A grainy risograph motion-graphics system: warm cream canvas (#f6eedd) under heavy film grain, with a hand-pulled drum-ink palette — violet #5b3df0, coral #ef5b3c, teal #1ba098, mustard #f4b841, rose #e9718f, sky #6db5d8 — and a deep indigo ink (#232038) for type and outlines. The app is one full-screen illustrated park map; every kept moment is a numbered sticker-pin in its own drum ink that expands into its Gaussian splat on a navy night plate (#1d2145). Display type is chunky Bricolage Grotesque extrabold; UI is Space Grotesk; every timestamp and tag is Space Mono uppercase. Cards are cream with thin ink outlines and 18–22px radii, numbered corner chips, and round play buttons — the sound-pack poster grammar. Motion is springy pop (back-out overshoot) for stickers and takeovers, with a self-drawing route and a 120× day replay."
---

Applies to `web/`. Tokens live in `web/app/globals.css` (@theme) and are mirrored for
SVG/canvas/WebGL in `web/lib/theme.ts` — change one, change both. Categorical label-family
colors live in `web/lib/mock/labels.ts` (validated scale, separate from the brand palette).

## Colors

- `cream` #f6eedd canvas · `cream-bright` #fdf8ec cards · `cream-deep` #ece1c8 wells.
- `ink` #232038 type/outlines · `ink-soft` #56536e secondary · `ink-faint` #767390 hints.
- Drum inks (each with `deep` text-safe + `soft` tint): violet / coral / teal / mustard /
  rose / sky (values in the description above). Every moment owns one, cycled by index —
  `MOMENT_INKS` in `lib/theme.ts`.
- `navy` #1d2145 / `navy-deep` #141732 — the night plate where splats live.
- Grain rides everything via the `.grained` / `.grained-heavy` utilities (soft-light
  turbulence overlay); the map and every riso card carry it.

## Typography

- Display: **Bricolage Grotesque** 700–800, tight leading — the title-card voice.
- UI/body: **Space Grotesk**.
- Labels/numerals: **Space Mono** bold uppercase +0.08em (`.tag`), tabular (`.tnum`).
  Every timestamp, coordinate, and metadata line speaks mono-uppercase.

## Components

- **Riso card** (`.riso-card`): cream-bright, 1.5px ink outline, 18–22px radius, grain.
- **Number chip**: `01`-style mono chip, plain or filled with a drum ink (`NumberChip`).
- **Play glyph**: round ink disc with cream triangle (`PlayGlyph`).
- **Splat pin**: cream ring + drum-ink disc + mono number on the map; outline-only until
  the replay reaches it; music gets a ♪ badge; hover label says "click to step inside".
- **Buttons**: ink pill primary (`inkButtonClass`), ink outline secondary; springy
  scale on hover/press.
- **Takeover**: full-screen navy plate washed with the moment's ink; splat stage framed
  by a cream hairline; evidence panels (seen / said / soundtrack) beside it.

## Motion

- `--ease-pop` cubic-bezier(0.34,1.56,0.64,1) for stickers, chips, takeovers (0.2–0.45s);
  `--ease-swift` cubic-bezier(0.22,1,0.36,1) for slides and draws.
- The route draws itself (stroke-dashoffset, pathLength=1); the day replays at 120× with
  the robot marker traveling the odometry and pins popping from outline to full ink.
- `prefers-reduced-motion`: everything lands on its final state instantly.
