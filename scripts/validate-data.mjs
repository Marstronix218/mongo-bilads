// Validation gate for the data layer (GODSON.md Phase 1-3, "validate and finalize").
// Checks data/billboards.json against the Billboard contract in types.ts §7.4,
// the tag vocabulary (§Phase 3), and the expected demoMatch winners (§Phase 1).
// Exits non-zero if anything fails, so it can gate a commit / dry-run.
//
// Run: node scripts/validate-data.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
const boards = JSON.parse(readFileSync(join(DATA, "billboards.json"), "utf8"));
const heatmap = JSON.parse(readFileSync(join(DATA, "traffic-heatmap.json"), "utf8"));

let errors = 0;
let warnings = 0;
const fail = (msg) => { console.error("  ✗ " + msg); errors++; };
const warn = (msg) => { console.warn("  ⚠ " + msg); warnings++; };

// --- Contract constants (mirror of types.ts §7.1 / §7.4) --------------------
const TRAFFIC_TYPES = new Set(["vehicle", "foot", "foot+vehicle"]);
// Allowed audienceTags vocabulary (GODSON.md §Phase 3).
const VOCAB = new Set([
  "commuters", "tech", "office workers", "professionals", "finance", "startups",
  "young professionals", "fitness", "outdoors", "eco-conscious", "affluent",
  "creatives", "foodies", "coffee", "nightlife", "walkable", "latino", "families",
  "students", "suburban", "value-seekers", "tourists", "shoppers",
]);
// Rough SF bounding box for a sanity check on coordinates.
const SF = { latMin: 37.70, latMax: 37.83, lngMin: -122.52, lngMax: -122.35 };

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isStr = (v) => typeof v === "string" && v.length > 0;

// =============================================================================
console.log("\n[1/6] Billboard schema (types.ts §7.4)");
// =============================================================================
if (!Array.isArray(boards)) fail("billboards.json is not an array");
if (boards.length < 12 || boards.length > 15)
  warn(`expected 12-15 boards (§8), found ${boards.length}`);

const ids = new Set();
for (const b of boards) {
  const at = `[${b.id ?? "?"}]`;
  if (!isStr(b.id)) fail(`${at} id must be a non-empty string`);
  if (ids.has(b.id)) fail(`${at} duplicate id`);
  ids.add(b.id);
  if (!isStr(b.name)) fail(`${at} name must be a non-empty string`);

  if (!isNum(b.lat) || b.lat < SF.latMin || b.lat > SF.latMax)
    fail(`${at} lat ${b.lat} outside SF bounds`);
  if (!isNum(b.lng) || b.lng < SF.lngMin || b.lng > SF.lngMax)
    fail(`${at} lng ${b.lng} outside SF bounds`);

  if (b.photo !== `/billboards/${b.id}.jpg`)
    fail(`${at} photo should be "/billboards/${b.id}.jpg", got "${b.photo}"`);

  // adCorners: exactly 4 [number, number] points
  if (!Array.isArray(b.adCorners) || b.adCorners.length !== 4)
    fail(`${at} adCorners must have exactly 4 points`);
  else b.adCorners.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0]) || !isNum(p[1]))
      fail(`${at} adCorners[${i}] must be [number, number]`);
  });

  if (!isNum(b.dailyImpressions) || b.dailyImpressions <= 0)
    fail(`${at} dailyImpressions must be a positive number`);
  if (!TRAFFIC_TYPES.has(b.trafficType))
    fail(`${at} trafficType "${b.trafficType}" not in ${[...TRAFFIC_TYPES]}`);
  if (!isNum(b.avgDwellSeconds) || b.avgDwellSeconds <= 0)
    fail(`${at} avgDwellSeconds must be a positive number`);
  if (!isNum(b.weeklyCostUsd) || b.weeklyCostUsd <= 0)
    fail(`${at} weeklyCostUsd must be a positive number`);
  if (!isStr(b.neighborhood)) fail(`${at} neighborhood must be a non-empty string`);
  if (typeof b.spanishFriendly !== "boolean")
    fail(`${at} spanishFriendly must be a boolean`);

  if (!Array.isArray(b.audienceTags) || b.audienceTags.length === 0)
    fail(`${at} audienceTags must be a non-empty array`);

  const d = b.demographics ?? {};
  for (const k of ["medianAge", "medianIncome", "footTrafficDaily", "hispanicSharePct"])
    if (!isNum(d[k])) fail(`${at} demographics.${k} must be a number`);
}
if (errors === 0) console.log(`  ✓ all ${boards.length} boards conform to the contract`);

// =============================================================================
console.log("\n[2/6] audienceTags vocabulary (GODSON.md §Phase 3)");
// =============================================================================
let tagErr = 0;
for (const b of boards)
  for (const t of b.audienceTags ?? [])
    if (!VOCAB.has(t)) { fail(`[${b.id}] tag "${t}" not in allowed vocabulary`); tagErr++; }
if (tagErr === 0) console.log("  ✓ every audienceTag draws from the vocabulary");

// =============================================================================
console.log("\n[3/6] Traffic heatmap (§7.6)");
// =============================================================================
if (heatmap.length < 200 || heatmap.length > 400)
  warn(`expected 200-400 points, found ${heatmap.length}`);
else console.log(`  ✓ ${heatmap.length} points (200-400)`);
const badPts = heatmap.filter(
  (p) => !Array.isArray(p) || p.length !== 3 ||
    p[0] < SF.latMin || p[0] > SF.latMax || p[1] < SF.lngMin || p[1] > SF.lngMax ||
    p[2] < 0 || p[2] > 1
);
if (badPts.length) fail(`${badPts.length} heatmap points malformed or out of bounds/range`);
else console.log("  ✓ all points are [lat, lng, intensity] within SF bounds, intensity 0..1");

// =============================================================================
console.log("\n[4/6] demoMatch winners (GODSON.md §Phase 1, intended formula)");
// =============================================================================
// Intended formula per the contract flag: w=1 => pure awareness (raw impressions).
const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
};
const scoreIntended = (imp, dm, w, cost) => (w * imp + (1 - w) * imp * dm * 3) / cost;

const byId = Object.fromEntries(boards.map((b) => [b.id, b]));
const top3Ids = (interests, w, budget) =>
  boards
    .filter((b) => b.weeklyCostUsd <= budget)
    .map((b) => ({ id: b.id, s: scoreIntended(b.dailyImpressions, jaccard(interests, b.audienceTags), w, b.weeklyCostUsd) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 3)
    .map((r) => r.id);

const VOLT = ["commuters", "fitness", "eco-conscious", "outdoors", "tech", "young professionals"];
const CASES = [
  { id: "Volt awareness (w .7)", interests: VOLT, w: 0.7, budget: 3000,
    expect: ["sf-101-vermont", "sf-mission-24th", "sf-soma-harrison"] },
  { id: "Volt targeted (w .15)", interests: VOLT, w: 0.15, budget: 3000,
    expect: ["sf-101-vermont", "sf-soma-harrison", "sf-marina-chestnut"] },
  { id: "Fog City Coffee (w .35)", interests: ["creatives", "foodies", "nightlife", "walkable", "coffee", "students"], w: 0.35, budget: 2200,
    expect: ["sf-mission-24th", "sf-valencia-mission", "sf-dogpatch-3rd"] },
  { id: "Ledgerly SaaS (w .5)", interests: ["tech", "office workers", "startups", "professionals", "commuters", "finance"], w: 0.5, budget: 3500,
    expect: ["sf-financial-montgomery", "sf-market-downtown", "sf-101-vermont"] },
];
const label = (id) => byId[id]?.name ?? id;
for (const c of CASES) {
  const got = top3Ids(c.interests, c.w, c.budget);
  const ok = got.length === c.expect.length && got.every((x, i) => x === c.expect[i]);
  if (ok) console.log(`  ✓ ${c.id}: ${got.map(label).join(" · ")}`);
  else fail(`${c.id}\n      expected: ${c.expect.map(label).join(" · ")}\n      got:      ${got.map(label).join(" · ")}`);
}

// Slider reorder moment + Sunset exclusion.
const voltAware = top3Ids(VOLT, 0.7, 3000);
const voltTarget = top3Ids(VOLT, 0.15, 3000);
if (voltAware.includes("sf-mission-24th") && !voltTarget.includes("sf-mission-24th") &&
    !voltAware.includes("sf-marina-chestnut") && voltTarget.includes("sf-marina-chestnut"))
  console.log("  ✓ slider reorder: awareness→targeted swaps Mission out, Marina in");
else warn("slider reorder moment (Mission↔Marina swap) did not hold — check on stage");

const sunsetInVolt = voltAware.includes("sf-sunset-irving") || voltTarget.includes("sf-sunset-irving");
if (!sunsetInVolt) console.log("  ✓ Sunset stays out of Volt's top 3 (deliberate low-fit)");
else fail("Sunset appeared in Volt's top 3 — should be low-fit");

// =============================================================================
console.log("\n[5/6] Provenance cross-check (billboards.provenance.json)");
// =============================================================================
try {
  const prov = JSON.parse(readFileSync(join(DATA, "billboards.provenance.json"), "utf8"));
  const provIds = new Set(prov.boards.map((p) => p.id));
  for (const b of boards)
    if (!provIds.has(b.id)) warn(`[${b.id}] has no provenance entry`);
  if (provIds.size === boards.length) console.log("  ✓ every board has a provenance record");
} catch { warn("billboards.provenance.json missing or unreadable"); }

// =============================================================================
console.log("\n[6/6] Frontend data sync (app/lib mirrors canonical sources)");
// =============================================================================
try {
  execFileSync("node", [join(__dirname, "sync-frontend-data.mjs"), "--check"], { stdio: "pipe" });
  console.log("  ✓ app/lib is in sync with canonical data/contract files");
} catch {
  fail("app/lib is stale vs canonical sources — run: node scripts/sync-frontend-data.mjs");
}

// =============================================================================
console.log(`\n${errors ? "✗" : "✓"} validation ${errors ? "FAILED" : "passed"} — ${errors} error(s), ${warnings} warning(s)\n`);
process.exit(errors ? 1 : 0);
