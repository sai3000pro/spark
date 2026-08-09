/**
 * The tab icon: the blob, blasting off.
 *
 * Run with `npm run build:icons`. Reads the already-cut sprite rather than the
 * art sheet, so this stays independent of build-blob-sprites.ts and its cell
 * geometry — the frame is a finished, registered drawing by the time we see it.
 *
 * ── WHY IT IS COMPOSITED ON A GROUND ────────────────────────────────────────
 * The blob is painted near-white on transparency. That is right on the app's
 * navy, and invisible on a browser's LIGHT tab strip, which is where a favicon
 * spends most of its life. Chrome and Safari both draw tab favicons directly on
 * the strip with no plate of their own, so a transparent white blob on a default
 * light theme is a blank square.
 *
 * So the icon carries its own dark ground. That is not a workaround — it is what
 * every icon in a tab strip does, and it also gives the golden lift-off flare
 * something to read against. The ground is a rounded square rather than a circle
 * because at 32px a circle loses ~21% of its area to the corners, and this
 * drawing needs every pixel it can get.
 *
 * ── WHY THE FLARE IS THE POINT ──────────────────────────────────────────────
 * `jump-3` is the apex of the leap: the blob with a starburst behind it and a
 * sparkle trail below. At 32px the blob alone is a white oval — indistinguishable
 * from a hundred other icons. The starburst is what survives the downscale and
 * what makes the shape read as SPARK rather than as a blob, so the crop is
 * chosen around the flare, not around the character.
 *
 * ── ABOUT THE .ico ──────────────────────────────────────────────────────────
 * sharp cannot write ICO, but ICO has permitted a whole PNG as its payload since
 * Windows Vista and every browser we care about honours it. The container is 22
 * bytes: a 6-byte header, a 16-byte directory entry, then the PNG. Hand-writing
 * it is far less machinery than adding an encoder dependency for one file.
 */
import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Same idiom as build-blob-sprites.ts: tsx compiles these to CJS, where neither
// `import.meta.dirname` nor top-level await exists.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SOURCE = path.join(ROOT, "public/sprites/blob/jump-3-right.webp");
const APP = path.join(ROOT, "app");

/** The app's ink-950. The icon's ground is the app's ground. */
const INK = { r: 8, g: 12, b: 20 };

/**
 * How much of the source frame to keep, as fractions of its own box.
 *
 * The cut sprite is 738x651 with a great deal of headroom — the frame has to
 * hold the apex flare AND leave the character on the same foot line as every
 * other pose, so the blob itself occupies the middle band. Measured off the
 * drawing: the flare's top ray starts around y 0.03 and the sparkle trail ends
 * around y 0.85, with the whole event between x 0.02 and x 0.75.
 */
const CROP = { left: 0.02, top: 0.02, width: 0.73, height: 0.84 };

/** Fraction of the icon's width left as breathing room around the drawing. */
const PAD = 0.06;

/** ICO wrapping a PNG. `size` is written as 0 when it is 256, per the format. */
function ico(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(1, 4); // one image

  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
  entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette size — 0 for truecolour
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12); // offset to the payload

  return Buffer.concat([header, entry, png]);
}

/** One square icon: dark rounded ground, drawing centred on it. */
async function render(size: number): Promise<Buffer> {
  const meta = await sharp(SOURCE).metadata();
  const sw = meta.width!;
  const sh = meta.height!;

  const art = await sharp(SOURCE)
    .extract({
      left: Math.round(CROP.left * sw),
      top: Math.round(CROP.top * sh),
      width: Math.round(CROP.width * sw),
      height: Math.round(CROP.height * sh),
    })
    // `contain` with a transparent background, so the drawing keeps its own
    // proportions inside the padded square instead of being squashed to it.
    .resize(Math.round(size * (1 - PAD * 2)), Math.round(size * (1 - PAD * 2)), {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // The radius tracks the size so 32px and 180px look like the same icon: 22% is
  // close to the squircle every platform rounds app icons to.
  const r = Math.round(size * 0.22);
  const ground = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" rx="${r}" ry="${r}"
             fill="rgb(${INK.r},${INK.g},${INK.b})"/>
     </svg>`,
  );

  return sharp(ground)
    .composite([{ input: art, gravity: "center" }])
    .png()
    .toBuffer();
}

async function main() {
  const [small, large] = await Promise.all([render(32), render(180)]);
  const bundle = ico(small, 32);

  // app/icon.png is what modern browsers take, at a size that also serves as the
  // touch icon; app/favicon.ico covers the bare /favicon.ico request that some
  // clients make without reading the document at all.
  await writeFile(path.join(APP, "icon.png"), large);
  await writeFile(path.join(APP, "favicon.ico"), bundle);

  console.log(`icon.png    180x180  ${large.length} bytes`);
  console.log(`favicon.ico  32x32   ${bundle.length} bytes`);
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exit(1);
});
