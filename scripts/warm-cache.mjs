// Pre-warm data/cache/ before the demo (Phase 5): creates a durable campaign,
// gets deterministic sample rankings, then hits /api/generate?warm=1 for every
// sample × top board × variants 0-1. Run with the dev server up and valid model
// credentials, then commit data/cache/ and public/generated/ for offline use.
//
//   node scripts/warm-cache.mjs [baseUrl]   (default http://localhost:3000)

const BASE = process.argv[2] ?? "http://localhost:3000";
const ORIGIN = new URL(BASE).origin;
const JSON_HEADERS = {
  "Content-Type": "application/json",
  Origin: ORIGIN,
  "Sec-Fetch-Site": "same-origin",
};

const SAMPLES = [
  {
    id: "volt",
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
    id: "fog-city",
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
    id: "ledgerly",
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
    const campaignResponse = await fetch(`${BASE}/api/campaigns`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        clientRequestId: crypto.randomUUID(),
        sampleId: sample.id,
        brief: sample.brief,
        campaign: sample.campaign,
      }),
    });
    const created = await campaignResponse.json();
    if (!campaignResponse.ok) {
      throw new Error(`${sample.brief.productName}: campaign creation failed (${campaignResponse.status}): ${JSON.stringify(created)}`);
    }
    const campaignId = created.campaign.id;

    // Deterministic research keeps the warmed board set aligned with stage mode.
    const researchResponse = await fetch(`${BASE}/api/research?demo=1`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        campaignId,
        requestId: crypto.randomUUID(),
        brief: sample.brief,
        campaign: sample.campaign,
      }),
    });
    const research = await researchResponse.json();
    if (!researchResponse.ok) {
      throw new Error(`${sample.brief.productName}: research failed (${researchResponse.status}): ${JSON.stringify(research)}`);
    }
    const boards = research.mediaBuyer.top3;
    console.log(`\n${sample.brief.productName}: warming ${boards.join(", ")}`);

    for (const billboardId of boards) {
      for (const variant of [0, 1]) {
        const body = {
          campaignId,
          requestId: crypto.randomUUID(),
          billboardId,
          brief: sample.brief,
          audienceProfile: research.researcher.audienceProfile,
          consistentBrand: false,
          variant,
        };
        const t0 = Date.now();
        const gen = await fetch(`${BASE}/api/generate?warm=1`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
        const raw = await gen.text();
        let out;
        try {
          out = JSON.parse(raw);
        } catch {
          throw new Error(`${sample.brief.productName}/${billboardId}/v${variant}: invalid JSON (${gen.status}): ${raw.slice(0, 300)}`);
        }
        if (!gen.ok) {
          throw new Error(`${sample.brief.productName}/${billboardId}/v${variant}: generation failed (${gen.status}): ${raw.slice(0, 300)}`);
        }
        if (!Array.isArray(out.concepts) || out.concepts.length !== 2) {
          throw new Error(`${sample.brief.productName}/${billboardId}/v${variant}: expected exactly two concepts`);
        }
        const imageUrls = out.concepts.map((concept) => concept.imageUrl);
        if (imageUrls.some((url) => typeof url !== "string" || !url.startsWith("/generated/"))) {
          throw new Error(`${sample.brief.productName}/${billboardId}/v${variant}: cache is not offline-safe: ${JSON.stringify(imageUrls)}`);
        }
        for (const imageUrl of imageUrls) {
          const asset = await fetch(new URL(imageUrl, BASE));
          if (!asset.ok || !asset.headers.get("content-type")?.startsWith("image/")) {
            throw new Error(`${sample.brief.productName}/${billboardId}/v${variant}: missing generated asset ${imageUrl}`);
          }
        }
        const verified = await fetch(`${BASE}/api/generate?demo=1`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ ...body, requestId: crypto.randomUUID() }),
        });
        const verifiedBody = await verified.json();
        if (!verified.ok || verifiedBody.executionMode !== "cache") {
          throw new Error(`${sample.brief.productName}/${billboardId}/v${variant}: demo cache verification failed (${verified.status})`);
        }
        console.log(
          `  ${billboardId} v${variant}: ${gen.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s ✓`
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
