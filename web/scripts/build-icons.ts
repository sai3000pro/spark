/**
 * The tab icon: a firefly.
 *
 * Run with `npm run build:icons`. Writes app/icon.png and app/favicon.ico.
 *
 * ── WHY A FIREFLY AND NOT THE ROBOT ─────────────────────────────────────────
 * This used to crop `jump-3` — the blob at the apex of its leap, chosen because
 * the starburst behind it was the only part of the character that survived the
 * downscale. That is the tell: if a drawing only reads because of the light
 * around it, ship the light.
 *
 * A firefly is already in this product's vocabulary rather than being invented
 * for the tab strip. They are painted into the aurora plate, recovered and
 * re-lit by .hero-fly in globals.css, drifting around the character's own
 * button, and one is named in the landing's own captions. It is also the only
 * mark here that survives 16px intact: a warm point of light in the dark is
 * legible at any size, which a face with two eyes and a mouth is not.
 *
 * ── WHY IT CARRIES ITS OWN GROUND ───────────────────────────────────────────
 * Unchanged from the version before it, and the reason is worth keeping: Chrome
 * and Safari draw favicons straight onto the tab strip with no plate of their
 * own, so anything light-on-transparent is a blank square on a light theme. The
 * ground is a rounded square rather than a circle because at 32px a circle
 * loses ~21% of its area to the corners, and a glow needs room to fall off.
 *
 * The whole drawing is authored as ONE vector at a 100-unit scale and rendered
 * at each size, so 16px and 180px are the same picture rather than two crops
 * that drift apart.
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
const APP = path.join(ROOT, "app");

/** The app's ink-950. The icon's ground is the app's ground. */
const INK = "#080c14";
/** --color-warn-400, the token .hero-fly is painted with. */
const WARN = "#facc15";
/** The hot centre. Warm rather than pure white, or it reads as a headlight. */
const CORE = "#fffdf0";

/**
 * The firefly, at a 100-unit scale.
 *
 * Composition notes, since none of this is arbitrary:
 *
 * - The light sits BELOW and RIGHT of centre (54, 58). A glow dead-centre reads
 *   as a button; offsetting it leaves room for the body above and makes the
 *   thing look like it is flying rather than sitting.
 * - Three nested falloffs, not one. A single radial gradient at this size goes
 *   flat and grey at the edge; a wide dim halo, a tight bright one and a solid
 *   core keep contrast in the middle where 16px sampling will land.
 * - The body and wings are drawn in the SAME warm family as the glow, dimmed —
 *   not in the ground colour. A dark body over a dark ground is a hole, and at
 *   32px a hole in the light is what kills the shape.
 * - Wings are barely there (0.22 alpha). They exist so the icon reads as an
 *   insect at 180px on a desktop shortcut, and they vanish harmlessly at 16px
 *   instead of turning into grey mud.
 */
function firefly(size: number): Buffer {
  // 22% is close to the squircle every platform rounds app icons to, and it
  // tracks the size so 32 and 180 look like the same icon.
  const r = 22;

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
       <defs>
         <radialGradient id="halo">
           <stop offset="0%"   stop-color="${WARN}" stop-opacity="0.55"/>
           <stop offset="45%"  stop-color="${WARN}" stop-opacity="0.18"/>
           <stop offset="100%" stop-color="${WARN}" stop-opacity="0"/>
         </radialGradient>
         <radialGradient id="lamp">
           <stop offset="0%"   stop-color="${CORE}" stop-opacity="1"/>
           <stop offset="55%"  stop-color="${WARN}" stop-opacity="0.92"/>
           <stop offset="100%" stop-color="${WARN}" stop-opacity="0"/>
         </radialGradient>
       </defs>

       <rect width="100" height="100" rx="${r}" ry="${r}" fill="${INK}"/>

       <!-- Wings, swept up and back. WARM, not white: the first cut drew these
            in the core colour at 0.22 and they rendered as a grey smudge over
            the ground — a dark icon has no room for a neutral mid-tone, which
            is precisely why the app's own .hero-fly is a bare radial gradient
            with no body at all. Kept small, kept in the amber family, and left
            faint enough to disappear cleanly at 16px rather than turn to mud. -->
       <g fill="${WARN}" opacity="0.30">
         <ellipse cx="41" cy="40" rx="10" ry="4" transform="rotate(-38 41 40)"/>
         <ellipse cx="49" cy="35" rx="8" ry="3.4" transform="rotate(-14 49 35)"/>
       </g>

       <!-- The body: a short warm taper running down into the light, so the glow
            belongs to something rather than floating free. -->
       <ellipse cx="48" cy="46" rx="5" ry="8.5"
                transform="rotate(20 48 46)" fill="${WARN}" opacity="0.5"/>

       <!-- The lantern. Wide falloff first, then the lamp, then the hot core. -->
       <circle cx="54" cy="58" r="40" fill="url(#halo)"/>
       <circle cx="54" cy="58" r="19" fill="url(#lamp)"/>
       <circle cx="54" cy="58" r="6.5" fill="${CORE}"/>
     </svg>`,
  );
}

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

const render = (size: number) => sharp(firefly(size)).png().toBuffer();

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
