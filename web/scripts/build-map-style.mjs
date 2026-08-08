/**
 * Regenerates public/map/night-walk.json — the NIGHT WALK map style — from the
 * pinned OpenFreeMap Liberty style (scripts/liberty-base.json).
 *
 *   node scripts/build-map-style.mjs
 *
 * Never hand-edit the output. The transform is categorical: every Liberty layer
 * falls into one bucket (ground, greens, water, road, path, building, label…)
 * and each bucket gets a NIGHT WALK treatment — hue from the palette, original
 * lightness compressed into the dark band so the map keeps its own contrast
 * ordering (casings darker than fills, motorways lighter than alleys) without
 * ever leaving the night. POI/transit/shield clutter is hidden outright: the
 * map is the poster's floor, not a navigation app.
 *
 * Palette values are duplicated from lib/theme.ts by hand (this script runs in
 * plain node, no TS) — if the palette moves, update PALETTE below and re-run.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, "liberty-base.json"), "utf8"));

// ── The night palette (mirrors lib/theme.ts) ────────────────────────────────
const PALETTE = {
  night: "#0f0d23",
  water: "#0b1226",
  waterEdge: "#1b2c4e",
  green: "#17253f", // parks & grass — indigo-teal, a step off the ground
  wood: "#141d32",
  sand: "#1c1836",
  roadCasing: "#0c0a1e",
  roadMinor: "#1e1a3e",
  roadMajor: "#262152",
  path: "#4a4478", // park paths read as faint starlit lines
  building: "#1b1837",
  rail: "#332d5e",
  boundary: "#2a2552",
  labelText: "#837daa",
  labelHalo: "#0f0d23",
  parkLabel: "#6f7fae",
  waterLabel: "#4f6ea0",
};

// ── Bucketing by layer id ───────────────────────────────────────────────────
const HIDE =
  /^(poi_|airport|aerodrome|highway_shield|highway-shield|highway-name-minor|road_one_way|ferry|aeroway_|cable_car|road_shield|housenumber)/;

/** id-pattern → paint overrides. First match wins. */
const RULES = [
  { re: /^background$/, paint: { "background-color": PALETTE.night } },
  { re: /^(park|landuse_pitch|landcover_grass|landuse_track)/, fill: PALETTE.green },
  { re: /^landcover_wood/, fill: PALETTE.wood },
  { re: /^(landcover_wetland|landcover_ice)/, fill: PALETTE.wood },
  { re: /^(landuse_residential|landuse_school|landuse_hospital|landuse_cemetery)/, fill: PALETTE.night },
  { re: /^landcover_sand/, fill: PALETTE.sand },
  { re: /^(water|waterway)/, fill: PALETTE.water, line: PALETTE.waterEdge },
  { re: /_casing$/, line: PALETTE.roadCasing },
  { re: /path_pedestrian|_path$|footway|steps/, line: PALETTE.path },
  { re: /motorway|trunk_primary|highway_major/, line: PALETTE.roadMajor },
  { re: /rail/, line: PALETTE.rail },
  { re: /^(tunnel|road|highway|bridge|street)/, line: PALETTE.roadMinor },
  { re: /^building/, fill: PALETTE.building, extrusion: PALETTE.building },
  { re: /^(boundary|admin)/, line: PALETTE.boundary },
  { re: /water_name|waterway_name/, text: PALETTE.waterLabel },
  { re: /park.*label|label.*park|poi_park/, text: PALETTE.parkLabel },
];

const out = structuredClone(base);
out.name = "Spark Night Walk";
// The shaded-relief raster fights the night ground; the vector source carries
// everything the app needs.
out.layers = out.layers.filter((l) => l.source !== "ne2_shaded");
delete out.sources.ne2_shaded;

for (const layer of out.layers) {
  if (HIDE.test(layer.id)) {
    layer.layout = { ...(layer.layout ?? {}), visibility: "none" };
    continue;
  }
  const rule = RULES.find((r) => r.re.test(layer.id));
  layer.paint = layer.paint ?? {};

  if (layer.type === "background" && rule?.paint) Object.assign(layer.paint, rule.paint);

  if (layer.type === "fill") {
    layer.paint["fill-color"] = rule?.fill ?? PALETTE.night;
    delete layer.paint["fill-pattern"];
    if (layer.paint["fill-outline-color"]) layer.paint["fill-outline-color"] = PALETTE.boundary;
  }

  if (layer.type === "fill-extrusion") {
    layer.paint["fill-extrusion-color"] = rule?.extrusion ?? PALETTE.building;
    layer.paint["fill-extrusion-opacity"] = 0.9;
  }

  if (layer.type === "line") {
    layer.paint["line-color"] = rule?.line ?? PALETTE.roadMinor;
    delete layer.paint["line-pattern"];
  }

  if (layer.type === "symbol") {
    layer.paint["text-color"] = rule?.text ?? PALETTE.labelText;
    layer.paint["text-halo-color"] = PALETTE.labelHalo;
    layer.paint["text-halo-width"] = 1.2;
    // Icons carry Liberty's daylight sprite colors; the night map speaks text.
    if (layer.layout?.["icon-image"]) delete layer.layout["icon-image"];
  }
}

const dest = join(here, "..", "public", "map");
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, "night-walk.json"), JSON.stringify(out, null, 1));
console.log(`night-walk.json written: ${out.layers.length} layers`);
