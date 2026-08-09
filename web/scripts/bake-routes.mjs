/**
 * Bake every authored walk onto real pedestrian ways.
 *
 * For each trip: pull every walkable way in its bbox from Overpass (footways,
 * sidewalks, crossings, steps, paths, pedestrian streets, park tracks), build
 * a node graph, and run Dijkstra between the trip's stops with road classes
 * cost-penalized — so the route prefers real pedestrian infrastructure and
 * only touches a road class to bridge a genuine gap (a signalled crossing, a
 * trailhead on a shoulder). Legs are Douglas-Peucker simplified to ~3.5 m and
 * written to lib/mock/trips/<trip>-route.gen.ts as [lat, lng] waypoint arrays.
 *
 * Where the world has no mapped ways because the honest walk is unconstrained
 * — Reynisfjara's sand, the STACKT container yard's aisles — a leg is
 * authored `direct` with hand-read waypoints instead, and passes through
 * verbatim.
 *
 *   node scripts/bake-routes.mjs            # bake everything not skipped
 *   node scripts/bake-routes.mjs alfama …   # bake specific trips
 *
 * Overpass responses are cached in .bake-cache/ next to this script, so
 * re-baking one stop tweak does not re-fetch the world. Delete the cache to
 * force fresh OSM data.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, ".bake-cache");
const OUT_DIR = join(HERE, "..", "lib", "mock", "trips");

// ─────────────────────────────────────────────────────────────────────────────
// Trip configs. Stops are real [lat, lng] read off OSM features; legs chain
// stops (optionally threading via-stops) or carry hand-read `direct` points.
// ─────────────────────────────────────────────────────────────────────────────

const TRIPS = {
  // The flagship. Already baked and shipped — kept here so the tool is the
  // full record of how every route was made. Skipped by default so a re-run
  // never silently reshapes the walk the app leads with.
  stackt: {
    skip: true,
    out: "stackt-route.gen.ts",
    bbox: "43.6325,-79.4135,43.6425,-79.3935",
    stops: {
      courtyard: [43.64085, -79.40235],
      ramparts: [43.6389, -79.40645],
      common: [43.6397, -79.40815],
      maples: [43.6348, -79.4074],
      silos: [43.6349, -79.3987],
      canoe: [43.63918, -79.39565],
      fieldNorth: [43.63955, -79.3956],
      trailMid: [43.6338, -79.404],
    },
    legs: [
      ["courtyard", "ramparts"],
      ["ramparts", "common"],
      ["common", "maples"],
      ["maples", "trailMid", "silos"],
      ["silos", "canoe"],
      ["canoe", "fieldNorth", "courtyard"],
    ],
  },

  // SummerHacks lives INSIDE the STACKT yard — container aisles no mapper has
  // drawn. Every leg is hand-read off the yard's lanes: north along the
  // Bathurst-side aisle, across between the stacks, never through a container.
  summerhacks: {
    out: "summerhacks-route.gen.ts",
    stops: {
      start: [43.64058, -79.4019],
      courtyard: [43.64085, -79.40235],
      buildRoom: [43.6411, -79.40218],
      demo: [43.64135, -79.40248],
      end: [43.64142, -79.40232],
    },
    legs: [
      {
        via: ["start", "courtyard"],
        direct: [
          [43.64058, -79.4019],
          [43.64066, -79.40208],
          [43.64071, -79.40206],
          [43.64079, -79.40228],
          [43.64085, -79.40235],
        ],
      },
      {
        via: ["courtyard", "buildRoom"],
        direct: [
          [43.64085, -79.40235],
          [43.64094, -79.40221],
          [43.64101, -79.40226],
          [43.6411, -79.40218],
        ],
      },
      {
        via: ["buildRoom", "demo"],
        direct: [
          [43.6411, -79.40218],
          [43.64118, -79.40236],
          [43.64126, -79.40233],
          [43.64131, -79.40247],
          [43.64135, -79.40248],
        ],
      },
      {
        via: ["demo", "end"],
        direct: [
          [43.64135, -79.40248],
          [43.64139, -79.40238],
          [43.64142, -79.40232],
        ],
      },
    ],
  },

  waterloo: {
    out: "waterloo-park-route.gen.ts",
    bbox: "43.4600,-80.5420,43.4730,-80.5200",
    stops: {
      start: [43.46407, -80.53301], // West Entrance, Father David Bauer Dr
      lake: [43.46568, -80.52765], // Silver Lake south shore, on the grass off the path
      green: [43.4656, -80.5315], // the open lawn mid-park
      bandstand: [43.466, -80.5264], // promenade by the Grist Mill
      pavilion: [43.46517, -80.53651], // the picnic shelter, west side
      snackBar: [43.4665, -80.5295], // central path by the lagoon
      hill: [43.467, -80.5335], // rise on the north path
      end: [43.46396, -80.53189], // South Entrance
    },
    legs: [
      ["start", "lake"],
      ["lake", "green"],
      ["green", "bandstand"],
      ["bandstand", "pavilion"],
      ["pavilion", "snackBar"],
      ["snackBar", "hill"],
      ["hill", "end"],
    ],
  },

  brooklyn: {
    out: "brooklyn-bridge-park-route.gen.ts",
    bbox: "40.6950,-74.0060,40.7070,-73.9860",
    stops: {
      start: [40.6975, -73.9985], // greenway at Pier 3
      pier: [40.6995, -73.9989], // Pier 2 courts
      carousel: [40.70443, -73.99238], // Jane's Carousel
      end: [40.7041, -73.9899], // Main Street lawn
    },
    legs: [
      ["start", "pier"],
      ["pier", "carousel"],
      ["carousel", "end"],
    ],
  },

  highline: {
    out: "high-line-route.gen.ts",
    bbox: "40.7380,-74.0120,40.7560,-73.9990",
    stops: {
      start: [40.73941, -74.00811], // Gansevoort St entrance
      overlook: [40.74245, -74.00575], // 10th Ave Square amphitheatre
      lawn: [40.746, -74.0048], // Chelsea Grasslands, ~20th St
      spur: [40.75335, -74.00095], // the Spur, 30th & 10th
      end: [40.754, -74.0023], // 30th St, toward 11th Ave
    },
    legs: [
      ["start", "overlook"],
      ["overlook", "lawn"],
      ["lawn", "spur"],
      ["spur", "end"],
    ],
  },

  alfama: {
    out: "alfama-route.gen.ts",
    bbox: "38.7080,-9.1360,38.7170,-9.1230",
    stops: {
      start: [38.7099, -9.12966], // Largo de São Rafael, low Alfama
      stairs: [38.71156, -9.12931], // the tiled steps by São Miguel
      terrace: [38.71174, -9.13022], // Miradouro de Santa Luzia
      tram: [38.71306, -9.12974], // Rua das Escolas Gerais, tram 28's street
      end: [38.7146, -9.1277], // Largo de São Vicente
    },
    legs: [
      ["start", "stairs"],
      ["stairs", "terrace"],
      ["terrace", "tram"],
      ["tram", "end"],
    ],
  },

  higashiyama: {
    out: "higashiyama-route.gen.ts",
    bbox: "34.9930,135.7760,35.0030,135.7890",
    stops: {
      start: [35.00095, 135.77867], // Ishibe-kōji lane
      lane: [34.9987, 135.7808], // Ninenzaka
      gate: [34.9949, 135.7846], // Kiyomizu-dera's vermilion Niōmon
      bamboo: [34.9996, 135.7805], // the bamboo cut by Kōdai-ji
      end: [35.0008, 135.7801], // Nene-no-Michi
    },
    legs: [
      ["start", "lane"],
      ["lane", "gate"],
      ["gate", "bamboo"],
      ["bamboo", "end"],
    ],
  },

  reynisfjara: {
    out: "reynisfjara-route.gen.ts",
    bbox: "63.3980,-19.0560,63.4110,-19.0180",
    stops: {
      start: [63.40433, -19.04523], // the car park
      columns: [63.40263, -19.03999], // the basalt columns at Hálsanefshellir
      waterline: [63.4033, -19.0428], // well back from the surf, mid-beach
      end: [63.40433, -19.04523],
    },
    legs: [
      // Car park onto the sand, then east along the cliff base to the columns.
      // The beach has no mapped ways — hand-read, hugging the dune line out.
      {
        via: ["start", "columns"],
        direct: [
          [63.40433, -19.04523],
          [63.40405, -19.0448],
          [63.40375, -19.0443],
          [63.40345, -19.0435],
          [63.4032, -19.0426],
          [63.403, -19.0417],
          [63.40285, -19.0409],
          [63.40263, -19.03999],
        ],
      },
      // Along the beach itself — sand has no ways; a hand-read arc that keeps
      // a respectful distance from the waterline (sneaker waves are real).
      {
        via: ["columns", "waterline"],
        direct: [
          [63.40263, -19.03999],
          [63.4028, -19.0409],
          [63.40295, -19.0417],
          [63.4031, -19.0422],
          [63.4033, -19.0428],
        ],
      },
      {
        via: ["waterline", "end"],
        direct: [
          [63.4033, -19.0428],
          [63.4035, -19.0435],
          [63.40375, -19.0442],
          [63.404, -19.0446],
          [63.40418, -19.0448],
          [63.40433, -19.04523],
        ],
      },
    ],
  },

  lionshead: {
    out: "lions-head-route.gen.ts",
    bbox: "-33.9440,18.3790,-33.9270,18.3960",
    stops: {
      start: [-33.93691, 18.3949], // trailhead off Signal Hill Rd
      contour: [-33.93967, 18.39117], // the switchback where Camps Bay opens
      chains: [-33.93615, 18.3902], // the chain/scramble section, upper east
      summit: [-33.93504, 18.38914], // Lion's Head peak
      end: [-33.9352, 18.389], // the summit rocks
    },
    legs: [
      ["start", "contour"],
      ["contour", "chains"],
      ["chains", "summit"],
      ["summit", "end"],
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Walking preference: real pedestrian infrastructure at cost 1, road classes
// at a stiff penalty so Dijkstra uses them only to bridge gaps.
// ─────────────────────────────────────────────────────────────────────────────

const COST = {
  footway: 1,
  path: 1,
  pedestrian: 1,
  cycleway: 1.1,
  steps: 1.4,
  living_street: 1.2,
  track: 1.1,
  service: 1.6,
  residential: 1.8,
  unclassified: 1.9,
  tertiary: 2.4,
  secondary: 2.8,
  primary: 3.2,
};

const M_LAT = 110574;

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function fetchWays(name, bbox) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${name}.json`);
  if (existsSync(cacheFile)) {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  }
  const query = `
[out:json][timeout:120];
(
  way["highway"~"^(${Object.keys(COST).join("|")})$"](${bbox});
);
out body geom;
`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "spark-route-bake/1.0 (mock-data bake)",
        },
        body: "data=" + encodeURIComponent(query),
      });
      if (res.ok) {
        const json = await res.json();
        writeFileSync(cacheFile, JSON.stringify(json));
        return json;
      }
      console.error(`  ${name}: HTTP ${res.status} from ${url}, retrying…`);
    } catch (e) {
      console.error(`  ${name}: ${e.message}, retrying…`);
    }
    await new Promise((r) => setTimeout(r, 20000));
  }
  throw new Error(`overpass gave up on ${name}`);
}

function buildGraph(osm, mLng) {
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * mLng);
  const key = (lat, lon) => lat.toFixed(6) + "," + lon.toFixed(6);
  const nodes = new Map();
  const adj = new Map();
  const addEdge = (a, b, w) => {
    const ka = key(a[0], a[1]);
    const kb = key(b[0], b[1]);
    if (!nodes.has(ka)) nodes.set(ka, a);
    if (!nodes.has(kb)) nodes.set(kb, b);
    const m = dist(a, b);
    if (m < 0.01) return;
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push([kb, m * w]);
    adj.get(kb).push([ka, m * w]);
  };
  for (const way of osm.elements) {
    if (way.type !== "way" || !way.geometry) continue;
    const w = COST[way.tags?.highway];
    if (!w) continue;
    if (way.tags?.foot === "no" || way.tags?.access === "private") continue;
    const pts = way.geometry.map((g) => [g.lat, g.lon]);
    for (let i = 1; i < pts.length; i++) addEdge(pts[i - 1], pts[i], w);
  }
  return { nodes, adj, dist };
}

function nearest(graph, pt) {
  let best = null;
  let bd = Infinity;
  for (const [k, ll] of graph.nodes) {
    const d = graph.dist(pt, ll);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return { key: best, d: bd };
}

/** Dijkstra over the foot graph with a real binary heap (Kyoto is dense). */
function dijkstra(graph, fromK, toK) {
  const distMap = new Map([[fromK, 0]]);
  const prev = new Map();
  const done = new Set();
  const heap = [[0, fromK]];
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, k] = pop();
    if (done.has(k)) continue;
    done.add(k);
    if (k === toK) break;
    for (const [nk, w] of graph.adj.get(k) ?? []) {
      const nd = d + w;
      if (nd < (distMap.get(nk) ?? Infinity)) {
        distMap.set(nk, nd);
        prev.set(nk, k);
        push([nd, nk]);
      }
    }
  }
  if (!prev.has(toK) && fromK !== toK) return null;
  const path = [toK];
  while (path[path.length - 1] !== fromK) path.push(prev.get(path[path.length - 1]));
  return path.reverse().map((k) => graph.nodes.get(k));
}

/** Douglas-Peucker on lat/lng with a metre tolerance. */
function simplify(pts, mLng, tolM = 3.5) {
  if (pts.length <= 2) return pts;
  const seg = (p, a, b) => {
    const ax = (p[1] - a[1]) * mLng;
    const ay = (p[0] - a[0]) * M_LAT;
    const bx = (b[1] - a[1]) * mLng;
    const by = (b[0] - a[0]) * M_LAT;
    const len2 = bx * bx + by * by || 1e-9;
    const t = Math.max(0, Math.min(1, (ax * bx + ay * by) / len2));
    return Math.hypot(ax - bx * t, ay - by * t);
  };
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = seg(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tolM) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), mLng, tolM);
  const right = simplify(pts.slice(idx), mLng, tolM);
  return [...left.slice(0, -1), ...right];
}

const constName = (a, b) =>
  `${a}_TO_${b}`.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();

async function bakeTrip(name, cfg) {
  console.error(`\n── ${name} ──`);
  const anchorLat = Object.values(cfg.stops)[0][0];
  const mLng = 111320 * Math.cos((anchorLat * Math.PI) / 180);

  let graph = null;
  if (cfg.bbox) {
    const osm = await fetchWays(name, cfg.bbox);
    graph = buildGraph(osm, mLng);
    console.error(`  graph: ${graph.nodes.size} nodes`);
  }

  const legs = [];
  for (const legCfg of cfg.legs) {
    const via = Array.isArray(legCfg) ? legCfg : legCfg.via;
    const a = via[0];
    const b = via[via.length - 1];
    let pts;
    if (!Array.isArray(legCfg) && legCfg.direct) {
      pts = legCfg.direct;
    } else {
      const stitched = [];
      let ok = true;
      for (let i = 1; i < via.length; i++) {
        const from = nearest(graph, cfg.stops[via[i - 1]]);
        const to = nearest(graph, cfg.stops[via[i]]);
        if (from.d > 60 || to.d > 60) {
          console.error(
            `  WARN ${via[i - 1]}->${via[i]}: snap ${Math.round(from.d)}/${Math.round(to.d)} m`,
          );
        }
        const path = dijkstra(graph, from.key, to.key);
        if (!path) {
          console.error(`  NO PATH ${via[i - 1]} -> ${via[i]}`);
          ok = false;
          break;
        }
        stitched.push(...(stitched.length ? path.slice(1) : path));
      }
      if (!ok) continue;
      // Stitch the true stop points onto the ends — the dwell spot itself may
      // sit on grass a few metres off the path, which is a legal walk.
      pts = simplify([cfg.stops[a], ...stitched, cfg.stops[b]], mLng);
    }
    const dist = (p, q) => Math.hypot((p[0] - q[0]) * M_LAT, (p[1] - q[1]) * mLng);
    let m = 0;
    for (let i = 1; i < pts.length; i++) m += dist(pts[i - 1], pts[i]);
    legs.push({ a, b, metres: Math.round(m), pts });
    console.error(`  ${a} -> ${b}: ${Math.round(m)} m, ${pts.length} pts`);
  }

  const lines = [
    "/**",
    " * GENERATED by scripts/bake-routes.mjs — do not hand-edit.",
    ` * The ${name} walk's legs on real pedestrian ways from OpenStreetMap`,
    " * foot-way data (Overpass pull, Dijkstra with road classes cost-penalized,",
    " * Douglas-Peucker simplified to ~3.5 m). Legs with no mapped ways (sand,",
    " * private yards) are hand-read waypoints instead. Coordinates are",
    " * [lat, lng]. Re-bake with the script if a stop moves.",
    " */",
    "",
  ];
  for (const leg of legs) {
    lines.push(`/** ${leg.a}->${leg.b} — ${leg.metres} m. */`);
    lines.push(
      `export const ${constName(leg.a, leg.b)}: Array<[number, number]> = [`,
    );
    for (const [lat, lng] of leg.pts) {
      lines.push(`  [${lat.toFixed(6)}, ${lng.toFixed(6)}],`);
    }
    lines.push(`];`, "");
  }
  writeFileSync(join(OUT_DIR, cfg.out), lines.join("\n"));
  console.error(`  wrote ${cfg.out}`);
}

const wanted = process.argv.slice(2);
for (const [name, cfg] of Object.entries(TRIPS)) {
  if (wanted.length ? !wanted.includes(name) : cfg.skip) continue;
  await bakeTrip(name, cfg);
}
