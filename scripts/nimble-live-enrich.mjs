// Augments data/nimble-signals/<boardId>.json with LIVE Nimble intelligence
// (GODSON.md Phase 3: "Wire live Nimble API for web-search/events/reviews").
//
// Uses the local Nimble CLI dependency with NIMBLE_API_KEY from the environment
// or .env / .env.local / app/.env.local. Per board it runs one
// lite web search scoped to the neighborhood + audience tags, then merges up
// to LIVE_MAX signal bullets into `signals` and fills `source_urls` — exactly
// the augmentation slot types.ts §G reserves for the live pipeline.
//
// Idempotent: previous live additions are tracked in the file's `live` block
// and replaced, never stacked. Per-board failures leave that file untouched.
//
//   node scripts/nimble-live-enrich.mjs            # all boards
//   node scripts/nimble-live-enrich.mjs sf-mission-24th  # one board
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SIGNALS = join(ROOT, "data", "nimble-signals");
const LOCAL_NIMBLE = join(ROOT, "app", "node_modules", ".bin", "nimble");
const LIVE_MAX = 2;
const LIVE_MARK = "nimble-live-search";

// --- env: prefer process.env, fall back to local env files -------------------
function loadKey() {
  if (process.env.NIMBLE_API_KEY) return process.env.NIMBLE_API_KEY;
  for (const f of [join(ROOT, ".env"), join(ROOT, ".env.local"), join(ROOT, "app", ".env.local")]) {
    if (!existsSync(f)) continue;
    const m = readFileSync(f, "utf8").match(/^NIMBLE_API_KEY=(.+)$/m);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}

function nimbleBin() {
  return existsSync(LOCAL_NIMBLE) ? LOCAL_NIMBLE : "nimble";
}

const key = loadKey();
if (!key) {
  console.error("NIMBLE_API_KEY not set (env, .env.local, or app/.env.local). Nothing to do.");
  process.exit(1);
}

function nimbleSearch(query, focus) {
  const res = spawnSync(
    nimbleBin(),
    ["search", "--query", query, "--focus", focus, "--max-results", "3", "--search-depth", "lite", "--country", "US", "--format", "json"],
    { env: { ...process.env, NIMBLE_API_KEY: key }, encoding: "utf8", timeout: 60_000 }
  );
  if (res.status !== 0) throw new Error(res.stderr?.trim() || `nimble exited ${res.status}`);
  return JSON.parse(res.stdout);
}

// Short map names → phrases search engines actually know.
const HOOD_PHRASE = {
  Mission: "Mission District",
  Richmond: "Richmond District",
  Sunset: "Sunset District",
  Downtown: "Downtown Market Street",
};

const trim = (s, n) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

const boards = JSON.parse(readFileSync(join(ROOT, "data", "billboards.json"), "utf8"));
const only = process.argv[2];
let ok = 0, failed = 0;

for (const b of boards) {
  if (only && b.id !== only) continue;
  const file = join(SIGNALS, `${b.id}.json`);
  if (!existsSync(file)) {
    console.log(`skip ${b.id} (no base signal file — run gen-nimble-signals.mjs first)`);
    continue;
  }
  const sig = JSON.parse(readFileSync(file, "utf8"));
  const hood = HOOD_PHRASE[b.neighborhood] ?? b.neighborhood;
  const query = `${hood} San Francisco new business openings and events`;

  try {
    // News focus keeps signal text local and current. Avoid a loose second
    // general search here because short neighborhood names like "Mission" can
    // drift into unrelated brand/domain results.
    const news = (nimbleSearch(query, "news").results ?? []).filter((r) => r.title);
    if (news.length === 0) throw new Error("no results");

    const liveSignals = news.slice(0, LIVE_MAX).map((r) => {
      const age = r.additional_data?.publish_date_raw;
      return `Live web${age ? ` (${age})` : ""}: ${trim(r.title, 70)} — ${trim(r.description ?? "", 110)}`;
    });
    const liveUrls = news.map((r) => r.url).filter(Boolean).slice(0, 3);

    // Replace any previous live additions (tracked in sig.live), never stack.
    const prevLive = new Set(sig.live?.signals ?? []);
    const base = sig.signals.filter((s) => !prevLive.has(s));
    sig.signals = [...base, ...liveSignals];
    const prevUrls = new Set(sig.live?.source_urls ?? []);
    sig.source_urls = [...sig.source_urls.filter((u) => !prevUrls.has(u)), ...liveUrls];
    if (!sig.derivedFrom.includes(LIVE_MARK)) sig.derivedFrom += ` + ${LIVE_MARK}`;
    sig.live = { signals: liveSignals, source_urls: liveUrls, query, fetchedAt: new Date().toISOString() };

    writeFileSync(file, JSON.stringify(sig, null, 2) + "\n");
    console.log(`ok   ${b.id}: +${liveSignals.length} live signals, ${liveUrls.length} sources`);
    ok++;
  } catch (e) {
    console.log(`fail ${b.id}: ${e.message.split("\n")[0]} (file left unchanged)`);
    failed++;
  }
}

// Reflect augmentation in index.json (derivedFrom is surfaced there).
const indexFile = join(SIGNALS, "index.json");
if (existsSync(indexFile) && !only) {
  const index = JSON.parse(readFileSync(indexFile, "utf8"));
  for (const entry of index.boards ?? []) {
    const f = join(SIGNALS, `${entry.boardId}.json`);
    if (existsSync(f)) entry.derivedFrom = JSON.parse(readFileSync(f, "utf8")).derivedFrom;
  }
  index.liveEnrichedAt = new Date().toISOString();
  writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");
}

console.log(`\n${ok} boards enriched, ${failed} failed.`);
process.exit(failed > 0 && ok === 0 ? 1 : 0);
