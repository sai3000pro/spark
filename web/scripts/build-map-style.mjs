/**
 * Regenerates the app's map styles from the pinned OpenFreeMap Liberty style
 * (scripts/liberty-base.json).
 *
 *   node scripts/build-map-style.mjs
 *
 * Never hand-edit the output. The transform is categorical: every Liberty layer
 * falls into one bucket (ground, greens, water, road, path, building, label…)
 * and each bucket gets a palette treatment, so the map keeps its own contrast
 * ordering (casings darker than fills, motorways lighter than alleys) without
 * ever leaving the register. POI/transit/shield clutter is hidden outright: the
 * map is the journal's page, not a navigation app.
 *
 * Two styles come out of the same transform:
 *
 *   field-notes.json — the shipped style. The walk drawn on the journal's own
 *     cream paper, like a naturalist's survey map: moss washes for the greens,
 *     a lagoon wash for water, vellum roads with fine sand casings, ink labels.
 *   night-walk.json  — the retired twilight style, still generated so flipping
 *     the app back is a one-line change in FieldMap.
 *
 * Palette values are duplicated from lib/theme.ts by hand (this script runs in
 * plain node, no TS) — if the palette moves, update the palettes below and re-run.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(join(here, "liberty-base.json"), "utf8"));

// ── FIELD NOTES — the journal's paper (mirrors lib/theme.ts) ────────────────
// Ground a half-step deeper than the page (#faf4e3) so vellum chrome lifts.
const FIELD_NOTES = {
  name: "Spark Field Notes",
  ground: "#f6efdb",
  water: "#a4d0c6", // a real lagoon — the water reads WET, not tinted paper
  waterEdge: "#6fa89c",
  green: "#d3dd9a", // parks & grass — living moss, inked with intent
  wood: "#bcd08f",
  sand: "#efe3c0",
  roadCasing: "#d9d0b0", // fine sand ink around every road
  roadMinor: "#fffbf0", // vellum
  roadMajor: "#f7ead0",
  path: "#b3a271", // park paths — a worn pen line
  building: "#efe6ca",
  rail: "#c9be9c",
  boundary: "#cfc6a6",
  labelText: "#52524a", // ink-soft
  labelHalo: "#faf4e3",
  parkLabel: "#5c611f", // moss, pressed deeper against the livelier green
  waterLabel: "#2d5b62", // lagoon, pressed deeper against the livelier water
  lightColor: "#fffbf0",
  lightIntensity: 0.05,
  buildingOpacity: 0.75,
};

// ── NIGHT WALK — the retired twilight register ──────────────────────────────
const NIGHT_WALK = {
  name: "Spark Night Walk",
  ground: "#0f0d23",
  water: "#0b1226",
  waterEdge: "#1b2c4e",
  green: "#17253f",
  wood: "#141d32",
  sand: "#1c1836",
  roadCasing: "#0c0a1e",
  roadMinor: "#1e1a3e",
  roadMajor: "#262152",
  path: "#4a4478",
  building: "#1b1837",
  rail: "#332d5e",
  boundary: "#2a2552",
  labelText: "#837daa",
  labelHalo: "#0f0d23",
  parkLabel: "#6f7fae",
  waterLabel: "#4f6ea0",
  lightColor: "#f2eefc",
  lightIntensity: 0.35,
  buildingOpacity: 0.9,
};

// ── Bucketing by layer id ───────────────────────────────────────────────────
const HIDE =
  /^(poi_|airport|aerodrome|highway_shield|highway-shield|highway-name-minor|road_one_way|ferry|aeroway_|cable_car|road_shield|housenumber)/;

function buildStyle(palette) {
  /** id-pattern → paint overrides. First match wins. */
  const RULES = [
    { re: /^background$/, paint: { "background-color": palette.ground } },
    { re: /^(park|landuse_pitch|landcover_grass|landuse_track)/, fill: palette.green },
    { re: /^landcover_wood/, fill: palette.wood },
    { re: /^(landcover_wetland|landcover_ice)/, fill: palette.wood },
    { re: /^(landuse_residential|landuse_school|landuse_hospital|landuse_cemetery)/, fill: palette.ground },
    { re: /^landcover_sand/, fill: palette.sand },
    { re: /^(water|waterway)/, fill: palette.water, line: palette.waterEdge },
    { re: /_casing$/, line: palette.roadCasing },
    { re: /path_pedestrian|_path$|footway|steps/, line: palette.path },
    { re: /motorway|trunk_primary|highway_major/, line: palette.roadMajor },
    { re: /rail/, line: palette.rail },
    { re: /^(tunnel|road|highway|bridge|street)/, line: palette.roadMinor },
    { re: /^building/, fill: palette.building, extrusion: palette.building },
    { re: /^(boundary|admin)/, line: palette.boundary },
    { re: /water_name|waterway_name/, text: palette.waterLabel },
    { re: /park.*label|label.*park|poi_park/, text: palette.parkLabel },
  ];

  const out = structuredClone(base);
  out.name = palette.name;
  // Flatten the extrusion side-shading: at full intensity the default light
  // turns tall buildings into dark slabs that punch through the flat register.
  out.light = { anchor: "viewport", color: palette.lightColor, intensity: palette.lightIntensity };
  // The shaded-relief raster fights the flat ground; the vector source carries
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
      layer.paint["fill-color"] = rule?.fill ?? palette.ground;
      delete layer.paint["fill-pattern"];
      if (layer.paint["fill-outline-color"]) layer.paint["fill-outline-color"] = palette.boundary;
    }

    if (layer.type === "fill-extrusion") {
      layer.paint["fill-extrusion-color"] = rule?.extrusion ?? palette.building;
      layer.paint["fill-extrusion-opacity"] = palette.buildingOpacity;
    }

    if (layer.type === "line") {
      layer.paint["line-color"] = rule?.line ?? palette.roadMinor;
      delete layer.paint["line-pattern"];
    }

    if (layer.type === "symbol") {
      layer.paint["text-color"] = rule?.text ?? palette.labelText;
      layer.paint["text-halo-color"] = palette.labelHalo;
      layer.paint["text-halo-width"] = 1.2;
      // Icons carry Liberty's own sprite colors; the journal's map speaks text.
      if (layer.layout?.["icon-image"]) delete layer.layout["icon-image"];
    }
  }

  return out;
}

const dest = join(here, "..", "public", "map");
mkdirSync(dest, { recursive: true });

for (const [file, palette] of [
  ["field-notes.json", FIELD_NOTES],
  ["night-walk.json", NIGHT_WALK],
]) {
  const style = buildStyle(palette);
  writeFileSync(join(dest, file), JSON.stringify(style, null, 1));
  console.log(`${file} written: ${style.layers.length} layers`);
}
