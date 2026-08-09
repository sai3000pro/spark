import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureBackground, measureBodyLuma, readRaw, luma, solveAlpha } from "./scripts/lib/key";
import { bodyCores, labelSheet, ownObjects, readingOrder, measureScale } from "./scripts/lib/sheet";

const DESIGN = join(dirname(fileURLToPath(import.meta.url)), "..", "design");

const SHEETS = [
  { file: "MoreAnimationsSprites.png", count: 24, rows: 3, floor: 0.1, minObject: 60 },
  { file: "Blob sleep-cycle strip.png", count: 5, rows: 1, floor: 0, minObject: 120 },
  { file: "Asking question.png", count: 4, rows: 1, floor: 0, minObject: 120 },
  { file: "Blob jumping.png", count: 5, rows: 1, floor: 0, minObject: 120 },
];

async function main() {
for (const spec of SHEETS) {
  const img = await readRaw(join(DESIGN, spec.file));
  const bg = measureBackground(img);
  const bodyY = measureBodyLuma(img);

  // halo histogram: what does the sub-0.25 alpha population look like?
  const low: number[] = [];
  for (let i = 0, p = 0; i < img.w * img.h; i += 3, p += img.c * 3) {
    const a = solveAlpha(luma(img.data[p], img.data[p + 1], img.data[p + 2]), bg.y, bodyY);
    if (a > 0.005 && a < 0.25) low.push(a);
  }
  low.sort((a, b) => a - b);
  const q = (f: number) => (low.length ? low[Math.min(low.length - 1, Math.floor(low.length * f))] : 0);

  const minCore = Math.floor((img.w * img.h) / spec.count / 12);
  const cores = readingOrder(bodyCores(img, bg, bodyY, { minCore }), spec.rows, img.h);
  const { labels, objects } = labelSheet(img, bg, bodyY, spec.floor, spec.minObject);
  const own = ownObjects(labels, img.w, objects, cores);

  const heights = cores.map((c) => c.box.y1 - c.box.y0 + 1);
  const areas = cores.map((c) => c.size);
  const maxAdopt = own.adopted.reduce((m, a) => Math.max(m, a.distance), 0);
  const smallestKept = objects.reduce((m, o) => Math.min(m, o.size), Infinity);

  console.log(`\n${spec.file}  ${img.w}x${img.h}`);
  console.log(
    `  bg luma ${bg.y.toFixed(1)}  body ${bodyY.toFixed(0)}  ` +
      `sub-0.25 alpha p99 ${q(0.99).toFixed(3)} p99.9 ${q(0.999).toFixed(3)}  floor ${spec.floor}`,
  );
  console.log(
    `  cores ${cores.length}/${spec.count}  heights ${Math.min(...heights)}..${Math.max(...heights)} ` +
      `(${(Math.max(...heights) / Math.min(...heights)).toFixed(2)}x)  ` +
      `area spread ${(Math.max(...areas) / Math.min(...areas)).toFixed(2)}x`,
  );
  console.log(
    `  objects ${objects.length}  smallest ${smallestKept}  welded ${own.welded.length}  ` +
      `adopted ${own.adopted.length} (max distance ${maxAdopt.toFixed(0)} px)`,
  );
  if (own.welded.length) {
    for (const w of own.welded) console.log(`  !! object ${w.objectId} holds cores ${w.cores.join(", ")}`);
  }
  // foot lines, on the white core
  console.log(`  foot   ${cores.map((c) => c.box.y1).join(" ")}`);
  const ref = cores[0];
  const s = cores.map((c) => measureScale(c, ref));
  console.log(`  scale vs its own frame 0: max spread ${(Math.max(...s.map((x) => x.spread)) * 100).toFixed(1)}%`);
}
}
main();
