/**
 * Real capture frames, cut out of the viewer screenshots in design/.
 *
 * Run with `npm run build:frames`.
 *
 * ── WHAT THE SOURCES ACTUALLY ARE ───────────────────────────────────────────
 * They are screenshots of the splat VIEWER, not renders. Every one of them has
 * the tool's own chrome sitting on top of the reconstruction: a control column
 * down the left (Cinematic / Reset / Capture clean photo, the spin and splat-size
 * sliders, the SH detail dropdown, the reference-frame thumbnail), a Transcript
 * panel top-right, an Objects list down the right, and a `current.raw.ply` /
 * `result.raw.ply` badge in the bottom-left corner.
 *
 * None of that can ship. An album cover is supposed to BE the photograph — see
 * the header of components/trip/JourneyCard.tsx — and a thumbnail with another
 * application's sliders in it reads as a screenshot of a debugging session, not
 * as a memory. So each frame is cropped to the largest clean rectangle of actual
 * reconstruction, and the crops below are hand-read off the panels rather than
 * guessed at, then verified by eye.
 *
 * What survives the crop is the real thing, and it looks like it: the smeared
 * white bloom around the edges of a capture, the floaters, the way a face
 * resolves sharply where the camera dwelt and dissolves where it swept past.
 * That texture is the entire reason to use these over the procedural stand-ins.
 *
 * ── THE COORDINATE TRAP ─────────────────────────────────────────────────────
 * 1 through 4 are 806x460 screenshots; 5 is a 3024x1724 retina PNG. The regions
 * are therefore written as FRACTIONS of each source, not pixels, so the same
 * numbers describe the same part of the interface at either scale, and so
 * re-shooting a screenshot at a different window size does not silently move
 * every crop.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// tsx compiles this to CJS, where import.meta.dirname does not exist.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..");
const DESIGN = path.join(WEB, "..", "design");
const OUT = path.join(WEB, "public/mock/frames");

/** Square covers are what the album grid asks Keyframe for. */
const COVER = 600;
/** The wide one, for the capability section's showcase. */
const WIDE = { w: 1280, h: 720 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Cut {
  /** Output basename, without extension. */
  name: string;
  src: string;
  /** Clean region, as fractions of the source. */
  box: Box;
  /**
   * A second, letterbox-shaped region for the 16:9 showcase still.
   *
   * The square box cannot be reused for it: it is taller than it is wide, so
   * fitting 16:9 inside it takes a thin horizontal band through the middle and
   * throws away the part of the scene that makes the frame worth showing.
   */
  wideBox?: Box;
  note: string;
}

/**
 * Where the reconstruction is, in each screenshot, once the panels are excluded.
 *
 * Read off the sources directly. The left control column is the binding
 * constraint in all five; the Transcript and Objects panels bind the right edge
 * in 2, 4 and 5; the burnt-in caption bubbles bind the bottom in 3.
 */
const CUTS: Cut[] = [
  {
    name: "sh-demo-cloud",
    src: "landing-page-1.jpg",
    // Panel ends at x 195/806 = 0.242. The cloud is centred right of it and the
    // frame is otherwise black to every edge, so this takes a tall square.
    box: { x: 0.29, y: 0.02, w: 0.55, h: 0.96 },
    note: "raw point cloud, pre-densification — the honest 'still reconstructing' frame",
  },
  {
    name: "sh-build-room",
    src: "landing-page-2.jpg",
    // Panel ends x 0.267; Transcript occupies y < 0.13 on the right. Starting
    // below it lets the crop run further right than the transcript would allow.
    box: { x: 0.31, y: 0.15, w: 0.48, h: 0.85 },
    note: "the long blue tables from above, mid-build",
  },
  {
    name: "sh-build-room-close",
    src: "landing-page-3.jpg",
    // Panel ends x 0.223 and stops at y 0.37. The burnt-in caption bubbles start
    // at y 0.88, so the crop stops short of them.
    box: { x: 0.25, y: 0.02, w: 0.48, h: 0.85 },
    note: "one person at a laptop, the sharpest face in the whole set",
  },
  {
    name: "sh-courtyard-meal",
    src: "landing-page-4.jpg",
    // Panel ends x 0.26; Transcript ends y 0.11; the Objects list starts x 0.825.
    box: { x: 0.28, y: 0.13, w: 0.5, h: 0.85 },
    note: "the table of food — the most legible subject of the five",
  },
  {
    name: "sh-courtyard",
    src: "landing-page-5.png",
    // The retina one. Panel ends x 0.259, and the `backpack` badge sits
    // bottom-left inside that same column, so excluding the panel excludes it.
    //
    // THE RIGHT EDGE IS 0.77, NOT 0.825. The Objects list starts at 0.825, but
    // the Transcript box above it is WIDER and starts at 0.778 — a first pass
    // measured the list, ran the crop to 0.815, and put the top-left corner of
    // the Transcript panel into the finished cover.
    box: { x: 0.275, y: 0.01, w: 0.495, h: 0.98 },
    wideBox: { x: 0.275, y: 0.06, w: 0.495, h: 0.5 },
    note: "people on the astroturf with their laptops — the widest, cleanest capture",
  },
];

/** Fractional box → integer pixel rect inside a source of this size. */
function rect(box: Cut["box"], w: number, h: number) {
  return {
    left: Math.round(box.x * w),
    top: Math.round(box.y * h),
    width: Math.round(box.w * w),
    height: Math.round(box.h * h),
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const cut of CUTS) {
    const file = path.join(DESIGN, cut.src);
    const meta = await sharp(file).metadata();
    const r = rect(cut.box, meta.width!, meta.height!);

    // `cover` centres the crop on the region we already chose, so a region that
    // is not square loses its outer edges rather than being squashed.
    const square = await sharp(file)
      .extract(r)
      .resize(COVER, COVER, { fit: "cover", position: "centre" })
      // Quality 82: these are noisy reconstructions, and the noise is the point.
      // Lower settings smear the floaters into bands, which reads as a bad JPEG
      // rather than as a capture.
      .webp({ quality: 82 })
      .toBuffer();

    await writeFile(path.join(OUT, `${cut.name}.webp`), square);
    console.log(
      `${cut.name.padEnd(22)} ${cut.src.padEnd(20)} ${r.width}x${r.height} → ${COVER}x${COVER}  ${square.length} bytes`,
    );
  }

  // The showcase still: the retina source is the only one with the resolution to
  // survive being shown at 1280 wide.
  const hero = CUTS.find((c) => c.wideBox)!;
  const heroFile = path.join(DESIGN, hero.src);
  const hm = await sharp(heroFile).metadata();
  const wr = rect(hero.wideBox!, hm.width!, hm.height!);
  const wide = await sharp(heroFile)
    .extract(wr)
    .resize(WIDE.w, WIDE.h, { fit: "cover", position: "centre" })
    .webp({ quality: 84 })
    .toBuffer();
  await writeFile(path.join(OUT, "showcase-wide.webp"), wide);
  console.log(
    `showcase-wide          ${hero.src.padEnd(20)} ${wr.width}x${wr.height} → ${WIDE.w}x${WIDE.h}  ${wide.length} bytes`,
  );
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
