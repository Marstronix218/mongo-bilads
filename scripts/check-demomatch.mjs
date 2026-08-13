// Sanity check: does the data produce the intended winners? (§8)
// For each sample we simulate the audienceProfile.interests the Researcher is
// LIKELY to emit, then compute demoMatch (Jaccard) and the Media Buyer
// valueScore against every in-budget board, and print the top 3.
//
// NOTE on the formula: PRD §5 defines
//   valueScore = ((1-w)*dailyImpressions + w*targetReach*3) / weeklyCostUsd
// but CampaignParams says w=1 => "pure awareness" while the formula makes w=1
// weight targetReach (i.e. targeted). The naming and the math disagree.
// We print BOTH orientations so the team can pick one; flagged to backend.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const boards = JSON.parse(
  readFileSync(join(__dirname, "..", "data", "billboards.json"), "utf8")
);

// Simulated Researcher interests per sample (best guess at LLM output).
const SIMS = [
  {
    id: "volt (awareness, w=0.7, budget $3000)",
    w: 0.7,
    budget: 3000,
    interests: ["commuters", "fitness", "eco-conscious", "outdoors", "tech", "young professionals"],
  },
  {
    id: "volt (targeted, w=0.15, budget $3000)",
    w: 0.15,
    budget: 3000,
    interests: ["commuters", "fitness", "eco-conscious", "outdoors", "tech", "young professionals"],
  },
  {
    id: "fog-city coffee (w=0.35, budget $2200)",
    w: 0.35,
    budget: 2200,
    interests: ["creatives", "foodies", "nightlife", "walkable", "coffee", "students"],
  },
  {
    id: "ledgerly saas (w=0.5, budget $3500)",
    w: 0.5,
    budget: 3500,
    interests: ["tech", "office workers", "startups", "professionals", "commuters", "finance"],
  },
];

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
};

// As-written formula (w weights targetReach).
const scoreAsWritten = (imp, demoMatch, w, cost) =>
  ((1 - w) * imp + w * imp * demoMatch * 3) / cost;

// Intended: w=1 => pure awareness (raw impressions), w=0 => pure targetReach.
const scoreIntended = (imp, demoMatch, w, cost) =>
  (w * imp + (1 - w) * imp * demoMatch * 3) / cost;

for (const sim of SIMS) {
  console.log("\n=== " + sim.id + " ===");
  const rows = boards
    .filter((b) => b.weeklyCostUsd <= sim.budget)
    .map((b) => {
      const dm = jaccard(sim.interests, b.audienceTags);
      return {
        name: b.name,
        dm: +dm.toFixed(2),
        asW: +scoreAsWritten(b.dailyImpressions, dm, sim.w, b.weeklyCostUsd).toFixed(2),
        intended: +scoreIntended(b.dailyImpressions, dm, sim.w, b.weeklyCostUsd).toFixed(2),
      };
    });
  const top = (key) =>
    [...rows].sort((x, y) => y[key] - x[key]).slice(0, 3)
      .map((r) => `${r.name} (dm ${r.dm}, ${r[key]})`).join("  |  ");
  console.log("  as-written top3:", top("asW"));
  console.log("  intended   top3:", top("intended"));
}
