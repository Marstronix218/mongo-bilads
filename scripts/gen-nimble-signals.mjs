// Generates data/nimble-signals/<boardId>.json — structured location intelligence
// per board (GODSON.md Phase 3, "collect and structure Nimble signals").
//
// Pre-API stand-in: derives signals from the REAL Google Places nearby-business
// data in billboard-fiber-businesses.json (aggregated across all permit records
// within RADIUS_MI of each board). The live Nimble pipeline refreshes/augments
// these with web search, events, and review scraping; the Research Agent reads
// whichever is present. Shape matches types.ts §G (NimbleSignalFile).
//
// Run: node scripts/gen-nimble-signals.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
const OUT = join(DATA, "nimble-signals");
mkdirSync(OUT, { recursive: true });

const boards = JSON.parse(readFileSync(join(DATA, "billboards.json"), "utf8"));
const fiber = JSON.parse(readFileSync(join(DATA, "billboard-fiber-businesses.json"), "utf8")).billboards;

const RADIUS_MI = 0.3;
const miles = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) * 69; // rough deg→mi

// Flatten all fiber records to (lat, lng, businesses[]) so we can pull nearby
// businesses regardless of which permit record they were scraped under.
const records = Object.values(fiber)
  .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
  .map((r) => ({ lat: r.lat, lng: r.lng, businesses: r.businesses ?? [] }));

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

const index = [];
for (const b of boards) {
  // Gather + dedupe nearby businesses within RADIUS_MI of the board.
  const seen = new Set();
  const nearby = [];
  for (const r of records) {
    if (miles([b.lat, b.lng], [r.lat, r.lng]) > RADIUS_MI) continue;
    for (const biz of r.businesses) {
      const key = biz.placeId ?? biz.name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      nearby.push(biz);
    }
  }

  // Frequency of business categories (primaryType + allTypes).
  const freq = {};
  const ratings = [];
  for (const biz of nearby) {
    for (const t of [biz.primaryType, ...(biz.allTypes ?? [])])
      if (t) freq[t] = (freq[t] ?? 0) + 1;
    if (Number.isFinite(biz.rating)) ratings.push(biz.rating);
  }
  const topCats = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([cat, n]) => `${cat}${n > 1 ? ` (${n})` : ""}`);

  const signals = [];
  let confidence;
  let derivedFrom;

  if (nearby.length >= 2) {
    signals.push(`${nearby.length} nearby businesses mapped within ${RADIUS_MI} mi`);
    if (topCats.length) signals.push(`Dominant nearby categories: ${topCats.join(", ")}`);
    if (ratings.length) {
      const avg = (ratings.reduce((s, x) => s + x, 0) / ratings.length).toFixed(1);
      signals.push(`${ratings.length} rated venues nearby, avg rating ${avg}/5`);
    }
    signals.push(`Audience fit: ${b.neighborhood} — ${b.audienceTags.slice(0, 3).join(", ")}`);
    // More real businesses → higher confidence, capped at 0.9.
    confidence = Math.min(0.9, 0.55 + Math.min(nearby.length, 12) * 0.03);
    derivedFrom = "google-places-nearby (real)";
  } else {
    // Sparse real data → neighborhood/audience-modeled fallback, flagged low-confidence.
    signals.push(`${b.neighborhood} corridor — ${b.trafficType.replace("+", " + ")} traffic`);
    signals.push(`Audience profile: ${b.audienceTags.join(", ")}`);
    signals.push(`Est. ${b.demographics.footTrafficDaily.toLocaleString()} daily foot traffic; median income $${b.demographics.medianIncome.toLocaleString()}`);
    if (b.spanishFriendly) signals.push(`${b.demographics.hispanicSharePct}% Hispanic — bilingual creative warranted`);
    confidence = 0.45;
    derivedFrom = "neighborhood-modeled (fallback; sparse Places data)";
  }

  const record = {
    boardId: b.id,
    location: `${b.name} (${titleCase(b.neighborhood)})`,
    signals,
    source_urls: [], // live Nimble populates these
    confidence: +confidence.toFixed(2),
    derivedFrom,
    nearbyBusinessCount: nearby.length,
  };
  writeFileSync(join(OUT, `${b.id}.json`), JSON.stringify(record, null, 2) + "\n");
  index.push({ boardId: b.id, confidence: record.confidence, nearbyBusinessCount: nearby.length, derivedFrom });
}

writeFileSync(join(OUT, "index.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  note: "Pre-API Nimble signal stand-in derived from Google Places nearby-business data. Live Nimble pipeline augments with web search, events, and review scraping.",
  boards: index,
}, null, 2) + "\n");

const real = index.filter((r) => r.derivedFrom.startsWith("google")).length;
console.log(`Wrote ${index.length} signal files to data/nimble-signals/ (${real} from real Places data, ${index.length - real} modeled fallback)`);
