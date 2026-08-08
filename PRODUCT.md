# Product

Applies to `web/` — the trip-replay app. (`ios/` and `tools/` are headless.)

## Register

product

## Users

You, after a walk. Spark (a companion robot) followed you through a park, decided on its own
what was worth keeping, and reconstructed those moments. The web app is where you relive the
trip: browse the moments, poke around the 3D splats, ask where you left your water bottle,
and audit why the pipeline kept what it kept. Users are the robot's owner (warm, curious,
reliving a memory) and the builders demoing the pipeline (they need the machine's reasoning
legible, not hidden).

## Product Purpose

Turn a robot's raw perception (detections, odometry, audio) into a memory you actually want
to revisit — and keep the pipeline honest by showing what was discarded, what is synthetic,
and why every decision was made. Success: the replay feels like an artifact worth keeping,
and the detection → candidate → moment chain can be audited from any screen.

## Brand Personality

The robot is a field naturalist and the site is its journal (FIELD NOTES, DESIGN.md v5):
grainy cream paper, pressed pine-and-brass inks, typewriter specimen tags, and a scroll
that re-enacts the day's sieve. The walk itself still lives on the twilight map — the
journal tells the day, the map is where the day happened. Three words: crafted, warm,
honest.

## Anti-references

- The riso-poster cream atlas, dark "mission control" dashboards, and paper-editorial
  journals — all prior designs.
- SaaS card-grid dashboards: identical gray cards, hero-metric tiles, gradient accents.
- Consumer photo-app gloss (Apple Photos / Google Photos): the machine's reasoning must stay visible.
- Default map chrome (Leaflet/Google Maps controls, attribution pills, POI clutter) — the
  map is real, but it must read as the poster's floor, not a navigation app.
- Sci-fi HUD / cyberpunk neon: the night is warm and calm, not aggressive.

## Design Principles

1. **The map IS the app.** One full-screen illustrated park; everything else floats over it
   or expands out of it. No page-shaped pages.
2. **Every moment owns an ink.** Each splat pin gets one drum ink from the riso palette; that
   color follows it into its chips, its takeover, its soundtrack card.
3. **Grain on everything.** Texture is the brand: film grain over the map, the cards, the
   night plate. Flat, saturated blocks — never gradients-as-decoration.
4. **Honesty is a feature.** Synthetic previews say so, discarded candidates stay visible in
   the bench, mock telemetry is labelled. Never dress a stand-in as the real thing.
5. **Motion is springy and earned.** Stickers pop, takeovers snap, the route draws itself and
   the day replays at 120× — motion re-enacts the walk or answers an interaction, never idles.

## Accessibility & Inclusion

WCAG AA. Body text ≥4.5:1 on paper; color never the sole carrier (labels accompany every
family color and state). Full `prefers-reduced-motion` alternatives — replays land on their
final state. Keyboard reachable: ⌘K palette, tabbable pins and ledger rows.
