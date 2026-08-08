/**
 * The aurora and the fireflies, rendered live.
 *
 * Both used to be painted into the plate. They are code now so they move — the
 * shipped plate (`Night forest _ no aurora_ no fireflies.png`) has an empty sky
 * and no dots.
 *
 * Nothing here is invented. `AURORA` and `FIREFLIES` in lib/heroAssets.ts are
 * MEASURED from the original artwork by scripts/build-design-assets.ts:
 *
 *   · the aurora colour is the light the painted curtains ADD — the difference
 *     between the painted plate and the stripped one. Sampling the painted
 *     pixels directly gives a blue-dominant rgb(46,76,103), which is not the
 *     aurora's colour but the aurora composited over a blue night sky. The
 *     emitted light is a mint-cyan, and that is what a `screen` layer must emit.
 *   · the fireflies sit where the artist put them, recovered by differencing the
 *     two plates and keeping the small warm dots.
 *
 * Server component — every bit of this is static markup plus CSS.
 */
import { AURORA, FIREFLIES } from "@/lib/heroAssets";

/**
 * Four curtains. Durations are deliberately near-coprime (23/31/41/53s) so the
 * composite never lands back in the same arrangement — with round numbers the
 * whole sky visibly resets on a short cycle, which is the tell that it is four
 * divs rather than weather.
 */
const RIBBONS = [
  { angle: 104, dur: 23, delay: 0, top: 0, height: 74, opacity: 0.5, blur: 54 },
  { angle: 82, dur: 31, delay: -7, top: 6, height: 62, opacity: 0.42, blur: 70 },
  { angle: 118, dur: 41, delay: -13, top: -4, height: 82, opacity: 0.34, blur: 86 },
  { angle: 94, dur: 53, delay: -21, top: 12, height: 56, opacity: 0.28, blur: 62 },
] as const;

export function HeroSky() {
  const band = AURORA.bottom - AURORA.top;

  return (
    <>
      <div
        className="hero-aurora"
        aria-hidden
        style={
          {
            "--au-core": AURORA.core,
            "--au-glow": AURORA.glow,
            // Positioned to the band the painted aurora actually occupied, so it
            // never washes over the treeline.
            top: `${AURORA.top * 100}%`,
            height: `${band * 100}%`,
          } as React.CSSProperties
        }
      >
        {RIBBONS.map((r, i) => (
          <span
            key={i}
            className="hero-aurora__ribbon"
            style={
              {
                "--angle": `${r.angle}deg`,
                "--dur": `${r.dur}s`,
                "--delay": `${r.delay}s`,
                "--blur": `${r.blur}px`,
                top: `${r.top}%`,
                height: `${r.height}%`,
                opacity: r.opacity,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="hero-flies" aria-hidden>
        {FIREFLIES.map((f, i) => (
          <span
            key={i}
            className="hero-fly"
            style={
              {
                left: `${f.x * 100}%`,
                top: `${f.y * 100}%`,
                "--fr": f.r,
                // Drift and twinkle run on different periods per fly, so no two
                // pulse together and neither loop lines up with the other.
                "--drift": `${7 + ((i * 5) % 7)}s`,
                "--twinkle": `${4.5 + ((i * 3) % 5)}s`,
                "--delay": `${-(i * 1.7).toFixed(1)}s`,
                "--swing": `${6 + ((i * 4) % 11)}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
    </>
  );
}
