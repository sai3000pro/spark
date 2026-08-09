/**
 * The aurora and the fireflies, rendered live.
 *
 * Both used to be painted into the plate. They are code now so they move — the
 * shipped plate (`Night forest _ no aurora_ no fireflies.png`) has an empty sky
 * and no dots.
 *
 * Nothing about the COLOUR here is invented. `AURORA` and `FIREFLIES` in
 * lib/heroAssets.ts are measured from the original artwork by
 * scripts/build-design-assets.ts:
 *
 *   · the aurora colour is the light the painted curtains ADD — the difference
 *     between the painted plate and the stripped one. Sampling the painted
 *     pixels directly gives a blue-dominant rgb(46,76,103), which is not the
 *     aurora's colour but the aurora composited over a blue night sky. The
 *     emitted light is a mint-cyan, and that is what a `screen` layer must emit.
 *   · the fireflies sit where the artist put them, recovered by differencing the
 *     two plates and keeping the small warm dots.
 *
 * ── WHY SVG AND NOT DIVS ────────────────────────────────────────────────────
 * This was four blurred `linear-gradient` divs first, and no amount of tuning
 * made it an aurora. A linear-gradient is straight by definition: at these
 * angles its stops become vertical stripes, and blurring straight stripes gives
 * you a green haze, not a curtain. An aurora is a RIBBON — a band that snakes
 * across the sky, hangs, and travels.
 *
 * So each curtain is a real wavy band: a closed path whose top and bottom edges
 * are sine curves of the same period, filled with a vertical gradient that is
 * brightest along the lower hem (which is how a real curtain reads) and fades
 * out above. The path runs one whole wavelength past each edge of the frame and
 * slides by exactly one wavelength per cycle, so the wave travels forever with
 * no visible seam. A second, slower animation on a wrapper makes it rise and
 * fall and breathe at a different period, so the two never sync.
 *
 * ── WHY ONE <svg> PER CURTAIN, ANIMATED AT THE ELEMENT LEVEL ────────────────
 * The first shipped version was a single <svg> with the travel/sway animations
 * on <g> groups inside it. Chromium promotes those groups to compositor layers
 * (will-change works inside SVG there), so it was smooth in Chrome — and a
 * slideshow in Safari. WebKit does not create compositor layers for transform
 * animations INSIDE an SVG subtree: it repainted four ~4000px-wide blurred,
 * masked paths through a `screen` blend on the main thread, every frame, at
 * 2x DPR. Measured on WebKit 26.5: 1.6 fps idle; pausing just these animations
 * took it to 13.6.
 *
 * WebKit does composite transform animations on HTML-level elements, so each
 * curtain is now its own absolutely-positioned <svg> with the travel animation
 * on the element itself, wrapped in a <span> carrying the sway. The wave math
 * survives because a percentage translateX of the element IS user units: the
 * element's width renders exactly VB_W user units, so one wavelength is
 * `len / VB_W * 100%` of the element — see --travel-pct below.
 *
 * The blur stays INSIDE each svg, as a real feGaussianBlur in user units,
 * rather than as CSS `filter: blur()` on the wrapper. Two reasons: the curtain
 * raster is static within its layer (the blur is computed once, not per
 * frame), and user-unit blur stretches with the viewBox exactly like the old
 * CSS blur on the inner <g> did, so the painted look does not change. The
 * filter region is widened well past the bbox so the blur never clips into a
 * hard edge.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Server component — every bit of this is static markup plus CSS.
 */
import { AURORA, FIREFLIES } from "@/lib/heroAssets";

/**
 * How much brighter the live curtains are than the light the painting added on
 * average.
 *
 * The measured delta is an AVERAGE over the whole curtain, and average light is
 * dim light: `screen`-blending the raw #152824 over the navy sky lifts green
 * from 15/255 to about 34/255, which the gradient and the blur then spread until
 * nothing is left. On the live page the aurora was simply not there.
 *
 * Scaling all three channels by the same factor leaves the HUE exactly as
 * measured — this is a gain control, not a repaint. That distinction matters:
 * an earlier attempt normalised the delta to full saturation instead, which
 * produced rgb(138,255,209) and washed the forest teal.
 */
const GAIN = 3.0;

/** #152824 → #3f786c. Channels scale together; clamped, though nothing hits it. */
function brighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.min(255, Math.round(c * GAIN)),
  );
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The curtains' own coordinate space. Stretched to the band by the viewBox. */
const VB_W = 1000;
const VB_H = 340;

/**
 * Three curtains.
 *
 * Periods are near-coprime (37/53/71s travel against 17/23/29s sway) so the
 * composite never lands back in the same arrangement. With round numbers the
 * whole sky visibly resets on a short cycle, which is the tell that it is a
 * handful of shapes rather than weather.
 *
 * `len` is the wavelength AND the travel distance per cycle — they are the same
 * number by construction, which is what makes the loop seamless. Changing one
 * without the other puts a jump in the sky every `dur` seconds.
 */
const CURTAINS = [
  { cy: 112, amp: 42, len: 440, thick: 112, phase: 0, dur: 37, sway: 17, opacity: 0.7, blur: 7, ray: 74 },
  { cy: 168, amp: 30, len: 320, thick: 86, phase: 2.1, dur: 53, sway: 23, opacity: 0.5, blur: 9, ray: 52 },
  { cy: 74, amp: 52, len: 660, thick: 150, phase: 4.0, dur: 71, sway: 29, opacity: 0.36, blur: 14, ray: 96 },
  // The fourth exists for COVERAGE, not for its own sake. Three curtains leave a
  // standing gap on the right: wherever the other three are all in a trough, the
  // sky there is empty and the aurora reads as a left-hand-corner effect. This
  // one is phased into that gap, and its 560 wavelength beats against the other
  // three so the hole never re-forms in the same place.
  { cy: 134, amp: 36, len: 560, thick: 124, phase: 3.3, dur: 43, sway: 19, opacity: 0.44, blur: 11, ray: 62 },
] as const;

/**
 * One curtain, as a closed path.
 *
 * Top edge left-to-right, bottom edge back again. Both edges are sines of period
 * `len`, and the thickness breathes on that same period with a phase offset —
 * same period on purpose, because a thickness that wandered on its own period
 * would break the seamless one-wavelength loop.
 *
 * Straight segments every len/14 are plenty: the whole thing is blurred, and a
 * cubic-smoothed path would cost more source than it is worth here.
 */
function curtainPath(c: (typeof CURTAINS)[number]): string {
  const step = c.len / 14;
  const from = -c.len;
  const to = VB_W + c.len;
  const k = (2 * Math.PI) / c.len;

  const top = (x: number) => c.cy + c.amp * Math.sin(k * x + c.phase);
  const bottom = (x: number) =>
    top(x) + c.thick * (1 + 0.3 * Math.sin(k * x + c.phase + 1.9));

  const pts: string[] = [];
  for (let x = from; x <= to; x += step) pts.push(`${x.toFixed(1)} ${top(x).toFixed(1)}`);
  for (let x = to; x >= from; x -= step) pts.push(`${x.toFixed(1)} ${bottom(x).toFixed(1)}`);
  return `M${pts.join("L")}Z`;
}

export function HeroSky() {
  const band = AURORA.bottom - AURORA.top;
  const core = brighten(AURORA.core);
  const glow = brighten(AURORA.glow);

  return (
    <>
      {CURTAINS.map((c, i) => (
        <span
          key={i}
          className="hero-aurora"
          aria-hidden
          style={
            {
              // Positioned to the band the painted aurora actually occupied, so
              // it never washes over the treeline.
              top: `${AURORA.top * 100}%`,
              height: `${band * 100}%`,
            } as React.CSSProperties
          }
        >
          <span
            className="hero-aurora__sway"
            style={
              {
                "--sway": `${c.sway}s`,
                "--delay": `${-i * 6}s`,
                opacity: c.opacity,
              } as React.CSSProperties
            }
          >
            <svg
              className="hero-aurora__travel"
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              // The sky is a band, not a square. Letting the curtains stretch to
              // fill it is correct — a real aurora is far wider than it is tall.
              preserveAspectRatio="none"
              style={
                {
                  "--travel-pct": `${(c.len / VB_W) * 100}%`,
                  "--dur": `${c.dur}s`,
                } as React.CSSProperties
              }
            >
              <defs>
                {/*
                  Brightest along the LOWER hem, fading out upward.

                  That asymmetry is most of what makes a shape read as an aurora
                  rather than as a cloud: the curtain's bottom edge is where the
                  particles hit the densest air, so it is sharp and bright, and
                  the top diffuses away.
                */}
                <linearGradient id={`spark-au-veil-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={core} stopOpacity="0" />
                  <stop offset="34%" stopColor={core} stopOpacity="0.5" />
                  <stop offset="78%" stopColor={glow} stopOpacity="1" />
                  <stop offset="100%" stopColor={glow} stopOpacity="0.12" />
                </linearGradient>

                {/*
                  Vertical rays — the striations that run down a curtain along
                  the magnetic field lines.

                  One pattern PER CURTAIN, at a different spacing each. A single
                  shared comb across all curtains was tried and it read as a
                  barcode: curtains sharing one grid of bars turns moving things
                  into one stationary fence.

                  The bars never fall below 0.62, so the curtain keeps its body
                  and only gains texture — bars that went to zero shredded it
                  into stripes. The skew is real physics being flattered: field
                  lines are not plumb.
                */}
                <linearGradient id={`spark-au-ray-${i}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#fff" stopOpacity="1" />
                  <stop offset="46%" stopColor="#fff" stopOpacity="0.62" />
                  <stop offset="54%" stopColor="#fff" stopOpacity="0.62" />
                  <stop offset="100%" stopColor="#fff" stopOpacity="1" />
                </linearGradient>
                <pattern
                  id={`spark-au-rays-${i}`}
                  width={c.ray}
                  height="10"
                  patternUnits="userSpaceOnUse"
                  patternTransform="skewX(-7)"
                >
                  <rect width={c.ray} height="10" fill={`url(#spark-au-ray-${i})`} />
                </pattern>
                <mask
                  id={`spark-au-ray-mask-${i}`}
                  maskUnits="userSpaceOnUse"
                  x={-2 * c.len}
                  y="-160"
                  width={VB_W + 4 * c.len}
                  height="700"
                >
                  <rect
                    x={-2 * c.len}
                    y="-160"
                    width={VB_W + 4 * c.len}
                    height="700"
                    fill={`url(#spark-au-rays-${i})`}
                  />
                </mask>
                {/*
                  The blur, in user units, exactly like the CSS blur on the old
                  inner <g>: stdDeviation stretches with the viewBox, so the
                  curtain is blurred more along its width than its height once
                  the band is stretched — which is what the tuned numbers were
                  tuned against. The region runs a wavelength past the bbox on
                  every side so the blur fades out instead of clipping.
                */}
                <filter
                  id={`spark-au-blur-${i}`}
                  x="-15%"
                  y="-120%"
                  width="130%"
                  height="340%"
                >
                  <feGaussianBlur stdDeviation={c.blur} />
                </filter>
              </defs>
              <g filter={`url(#spark-au-blur-${i})`}>
                <path
                  d={curtainPath(c)}
                  fill={`url(#spark-au-veil-${i})`}
                  mask={`url(#spark-au-ray-mask-${i})`}
                />
              </g>
            </svg>
          </span>
        </span>
      ))}

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
