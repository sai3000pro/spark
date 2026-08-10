/**
 * The landing scene. First thing you see, every visit.
 *
 * Server component — the plate, the type, the scrim and the cue are all static
 * HTML and CSS. The only client code in the hero is the blob, which needs the
 * live-trip state.
 *
 * THE PLATE BOX is the load-bearing structural idea. `object-fit: cover` does its
 * cropping INSIDE the element, so a percentage inside the hero is not a
 * percentage of the artwork — and the blob would drift off the painted path at
 * every viewport size. Instead the cover geometry is reproduced explicitly as a
 * sized box (see .hero-plate-box in globals.css) and the blob is positioned
 * inside it, so its coordinates are plate coordinates and it stays on the path
 * from 362px to ultrawide.
 *
 * The plate is MIRRORED at build time. The lit path is nearly white — measured
 * p90 luminance 95-146, which is 1.1-2.8:1 against our text — and the reference
 * composition puts the headline right on top of it. Flipping the artwork moves
 * the path and the blob to the right and hands the copy the dark left third at
 * about 9:1, which buys legibility without dimming the illustration.
 */
import { HeroBlobButton } from "@/components/hero/HeroBlobButton";
import { HeroSky } from "@/components/hero/HeroSky";
import { ScrollCue } from "@/components/shell/ScrollCue";
import { BLOB_ANCHOR, PLATE } from "@/lib/heroAssets";

/**
 * No props.
 *
 * There used to be a stat line here — "[ Sunday, August 2 · Waterloo Park ·
 * 1.73 km walked · 6 moments kept ]" — describing the most recent walk. It is
 * gone: the scene's job is the promise, and the numbers for the most recent trip
 * are two hundred pixels below on the album that owns them.
 */
export function LandingHero() {
  return (
    <section
      className="hero-stage h-hero"
      style={
        {
          "--plate-ar": PLATE.wide.ar,
          "--plate-ar-tall": PLATE.tall.ar,
          "--blob-cx": BLOB_ANCHOR.wideCx,
          "--blob-cx-tall": BLOB_ANCHOR.tallCx,
          "--blob-feet-y": BLOB_ANCHOR.feetY,
          "--blob-h": BLOB_ANCHOR.heightFrac,
        } as React.CSSProperties
      }
    >
      <div className="hero-plate-box">
        <picture>
          <source
            media="(min-aspect-ratio: 4/5)"
            type="image/avif"
            srcSet="/hero/aurora-wide-1600.avif 1600w, /hero/aurora-wide-2400.avif 2400w"
            sizes="100vw"
          />
          <source
            media="(min-aspect-ratio: 4/5)"
            type="image/webp"
            srcSet="/hero/aurora-wide-1600.webp 1600w, /hero/aurora-wide-2400.webp 2400w"
            sizes="100vw"
          />
          <source
            type="image/avif"
            srcSet="/hero/aurora-tall-900.avif 900w, /hero/aurora-tall-1350.avif 1350w"
            sizes="100vw"
          />
          <source
            type="image/webp"
            srcSet="/hero/aurora-tall-900.webp 900w, /hero/aurora-tall-1350.webp 1350w"
            sizes="100vw"
          />
          {/* A raw <img> on purpose. These are pre-encoded at widths and
              qualities chosen against a measured banding curve, and routing them
              through next/image would re-encode at quality:75 and throw that
              away — as well as making the hero depend on sharp at serve time,
              which is only present here as an undeclared transitive dependency.
              We also need art direction (a different CROP, not just a different
              width), which next/image has no <source media> for.

              No eslint-disable needed, unlike Keyframe.tsx: @next/next's
              no-img-element rule returns early when the grandparent is <picture>. */}
          <img
            src="/hero/aurora-wide-1600.webp"
            alt=""
            aria-hidden
            width={1600}
            height={903}
            // sync, NOT async. The aurora above this image blends with it via
            // mix-blend-mode; if the image is still decoding when that blend
            // group first rasterises, Chrome composites the group against an
            // empty backdrop and never re-composites when the image lands — the
            // entire scene renders black until something forces a repaint.
            decoding="sync"
            fetchPriority="high"
            className="hero-plate"
          />
        </picture>

        {/* The aurora and the fireflies, live. Sits directly on the plate so its
            `screen` blend reads against the artwork, and below the scrim so the
            handoff gradient still darkens it into the library. */}
        <HeroSky />

        {/* Exactly one scrim, and it lives INSIDE the plate box, above the
            artwork but BELOW the blob. That ordering is the point: the scrim is
            the fold that hands the scene off to the library, and the blob must
            not be dimmed by it — the character is the brightest thing on the
            screen and the thing you are meant to click. */}
        <span className="hero-scrim" aria-hidden />

        {/* The blob's own light on the path. One radial gradient, anchored to
            the measured feet. */}
        <span className="hero-glow" aria-hidden />
        <HeroBlobButton />
      </div>

      <div className="hero-copy">
        {/* Two sentences, one per line, broken deliberately rather than left to
            the measure — the balance of the two halves IS the line, and a wrap
            that lands after "Spark" reads as a mistake at display size. */}
        <h1 className="hero-title">
          <span className="hero-title__line">You enjoy the journey.</span>
          <span className="hero-title__line">Spark captures the magic.</span>
        </h1>
        <p className="hero-lede">
          Spark rolls right behind you, dropping the perfect playlist for your vibe and tracking
          down lost items. It tags along to capture spontaneous 3D memories, letting you step
          right back into the moment long after the trip is over.
        </p>
      </div>

      {/* No props any more. The cue used to take a target because the library was
          a section stacked under this hero; it is its own route now, so ScrollCue
          owns its destination (/album) and there is nothing left to pass. */}
      <ScrollCue />
    </section>
  );
}
