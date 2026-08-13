// Pre-warm data/cache/ before the demo (Phase 5): hits /api/generate?live=1
// for every sample × its likely top boards × variants 0-1 so the on-stage
// cached path always has real creatives to fall back to. Run with the dev
// server up and a valid GMI_API_KEY in .env.local, then COMMIT data/cache/
// and public/generated/ so the demo works with wifi off.
//
//   node scripts/warm-cache.mjs [baseUrl]   (default http://localhost:3000)

const BASE = process.argv[2] ?? "http://localhost:3000";

const SAMPLES = [
  {
    brief: {
      productName: "Volt",
      description:
        "A premium electric commuter bike for getting across the city without a car. Long range, app-unlock, and a lightweight frame built for daily riders who care about the planet and hate parking.",
      audience:
        "Car-free and car-light San Franciscans, 25-40, who commute, work out, and want an eco-friendly way to move around the city.",
    },
    campaign: { weeklyBudgetUsd: 3000, campaignWeeks: 4, awarenessWeight: 0.7 },
  },
  {
    brief: {
      productName: "Fog City Coffee",
      description:
        "A neighborhood micro-roaster and cafe pouring single-origin espresso and cold brew. Slow mornings, late-night pour-overs, and a rotating wall of local artists.",
      audience:
        "Neighborhood creatives, freelancers, and foodies who walk to their coffee and care about where the beans come from.",
    },
    campaign: { weeklyBudgetUsd: 2200, campaignWeeks: 4, awarenessWeight: 0.35 },
  },
  {
    brief: {
      productName: "Ledgerly",
      description:
        "Accounting software built for startups. Automated books, real-time runway, and one dashboard your whole finance team can trust. Close the month in a day, not a week.",
      audience:
        "Founders, operators, and finance leads at San Francisco startups and small tech companies who are tired of spreadsheets.",
    },
    campaign: { weeklyBudgetUsd: 3500, campaignWeeks: 6, awarenessWeight: 0.5 },
  },
];

async function main() {
  for (const sample of SAMPLES) {
    // Ask the research endpoint which boards this sample actually lands on.
    const res = await fetch(`${BASE}/api/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sample),
    });
    const research = await res.json();
    const boards = research.mediaBuyer.top3;
    console.log(`\n${sample.brief.productName}: warming ${boards.join(", ")}`);

    for (const billboardId of boards) {
      for (const variant of [0, 1]) {
        const body = {
          billboardId,
          brief: sample.brief,
          audienceProfile: research.researcher.audienceProfile,
          consistentBrand: false,
          variant,
        };
        const t0 = Date.now();
        const gen = await fetch(`${BASE}/api/generate?live=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await gen.json();
        const placeholder = out.concepts?.some((c) => c.imageUrl.includes("placeholder"));
        console.log(
          `  ${billboardId} v${variant}: ${gen.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
            (placeholder ? "  ⚠️ placeholder image — live gen failed, NOT a real warm" : "  ✓")
        );
      }
    }
  }
  console.log("\nDone. Commit data/cache/ and public/generated/ for offline demo safety.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
