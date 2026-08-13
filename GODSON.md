# Godson — Data & Sponsor Integration Lead

**Role:** Data curation, GMI Cloud model selection, Nimble data pipeline, billboard dataset, photos, caching, and data-side sponsor integration.

Godson owns all data that flows into the system: billboard records, audience tags, heatmaps, sample products, cached outputs, and the Nimble research pipeline that provides live market intelligence.

---

## Phase 0: Setup — GMI Cloud (0:00-0:15) — ✅ DONE

- [x] API key confirmed working (74 chat models listed)
- [x] LLM picked: **`google/gemini-3.5-flash`** — ~2.6s, clean strict JSON, vision-capable
- [x] Image model picked: **`gemini-3.1-flash-image`** — ~17s/image, excellent quality
- [x] Model IDs in `app/lib/gmi.ts` defaults + `.env.example` + `.env`
- [x] Documented quirks:
  - `deepseek-ai/DeepSeek-V3` (old default) does NOT exist on the cluster → 404
  - Image models are NOT on the OpenAI-compatible cluster — `/images/generations`
    404s ("No matching target server"). They live on the async request queue at
    `console.gmicloud.ai/api/v1/ie/requestqueue/apikey/requests` (responds
    synchronously ~17s, Gemini-style `candidates/parts` payload). `image()` in
    `app/lib/gmi.ts` handles this.
  - Aspect ratio `2:1` is REJECTED; use `16:9` (composite warp absorbs the diff)
  - Image calls need their own timeout (45s) — 17s gen vs the 20s chat timeout
  - Next.js reads local environment variables from `app/.env.local`; keep that as the single local env file

---

## Phase 1: Billboards Dataset v1 (0:15-1:00)

**Status: 14 boards already curated in `data/billboards.json`** — validate and finalize.

> **Automated:** `node scripts/validate-data.mjs` now gates all checks below (schema,
> vocabulary, heatmap, demoMatch winners, slider reorder, Sunset exclusion). Passing ✓.

- [x] Verify all 14 boards match the `Billboard` schema from `types.ts` exactly — all fields required
- [x] Confirm data range covers all three sample products well:
  - **Volt awareness (w=0.7):** top 3 should be 101 Vermont, 24th/Mission, Harrison ✓
  - **Volt targeted (w=0.15):** top 3 should be 101 Vermont, Harrison, Chestnut/Marina ✓
  - **Fog City Coffee (w=0.35):** top 3 should be 24th/Mission, Valencia, 3rd/Dogpatch ✓
  - **Ledgerly SaaS (w=0.5):** top 3 should be Montgomery/FiDi, Market/Powell, 101 Vermont ✓
- [x] Verify the **slider reorder moment** works: dragging Volt from awareness to targeted should swap Mission out for Marina and lift Harrison
- [x] Confirm Sunset is deliberately low-fit for Volt and never enters its top 3
- [ ] Collect one photo per board: Street View screenshots with big, front-facing rectangular board visible (MANUAL — needs Street View)
  - Save as `/public/billboards/<id>.jpg`

### Data Source References (for Q&A)

- Locations: real SF Planning GAS permit records (`sf-billboards.geojson`, 559 records)
- Provenance: `billboards.provenance.json` maps each `id` to real `record_id` and coordinates
- Pricing: cross-checked against permit `rate_card` ranges (9/14 inside range, 4 slightly above, 1 below)
- Demographics: Census/DataSF neighborhood profiles
- Impressions: order-of-magnitude estimates from AdQuick/Blip listings

---

## Phase 2: Annotation + Heatmap + Samples (1:00-2:00)

### Photo Annotation

- [ ] For each photo: open in image editor, note the 4 pixel corners of the blank board area in **TL, TR, BR, BL** order
- [ ] Update `adCorners` in `billboards.json` (current values are placeholders)
- [ ] **Sanity check first:** pick one photo + corners, hand to Steven for a quick composite test before annotating the rest
- [ ] Iterate if corners are off — perspective warp must look convincing on stage

### Heatmap

- [x] `scripts/gen-heatmap.mjs` already exists — regenerate if needed: `node scripts/gen-heatmap.mjs`
- [x] Verify `data/traffic-heatmap.json` has 200-400 weighted `[lat, lng, intensity]` points along 101/280/Market/Mission/Marina (304 points ✓, validated)
- [x] Spot-check: points should cluster along major corridors, not scatter randomly (bounds-checked in validate-data.mjs)

### Samples

- [x] `data/samples.ts` already exists with 3 briefs — verify campaign defaults produce correct top-3 results ✓
- [ ] Generate sample product images -> `/public/samples/{volt,fog-city,ledgerly}.png` (BLOCKED — needs GMI image model / Phase 0)
  - Use GMI Cloud image model
  - Product-style images suitable for the upload preview
- [x] Run `node scripts/check-demomatch.mjs` to validate demoMatch rankings for all samples

---

## Phase 3: Finalize Dataset + Sponsor Data (2:00-3:00)

### Dataset Finalization

- [ ] Final demoMatch sanity check: for each sample brief, mentally rank the boards and compare to Jaccard results
- [ ] If any winner looks wrong, adjust `audienceTags` — **never change the scoring math**
- [ ] Tag vocabulary (keep audienceTags drawing from this set):
  ```
  commuters, tech, office workers, professionals, finance, startups,
  young professionals, fitness, outdoors, eco-conscious, affluent, creatives,
  foodies, coffee, nightlife, walkable, latino, families, students, suburban,
  value-seekers, tourists, shoppers
  ```

### Sponsor: Nimble Data Pipeline

- [ ] Set up Nimble API integration for live market intelligence:
  - Web search for competitor billboard campaigns in SF
  - Location-based business data extraction for each board neighborhood
  - Local event and trending topic collection
  - Review and customer discussion scraping for relevant categories
- [x] For each board, collect and structure Nimble signals (shape in types.ts §G `NimbleSignal`):
  ```json
  {
    "location": "Market Street near Powell Station",
    "signals": [
      "high public transit activity",
      "nearby universities and retail",
      "large volume of young adult foot traffic"
    ],
    "source_urls": [],
    "confidence": 0.84
  }
  ```
- [x] Store Nimble results in `data/nimble-signals/<boardId>.json` (13/14 from real Google Places data via `scripts/gen-nimble-signals.mjs`; live Nimble API augments)
- [x] Pipe Nimble signals into the Research Agent's context so they influence recommendations (app/lib/nimble.ts → researcher prompt; `[Nimble] `-prefixed findings for UI badges)
- [x] Wire live Nimble API for web-search/events/reviews (`scripts/nimble-live-enrich.mjs` — Nimble CLI news-focus search per board; merges live signals + source_urls into `data/nimble-signals/`, idempotent re-runs)
- [ ] **Key demo point:** Show that Nimble intelligence changes the recommendation vs. static data alone

### Sponsor: InsForge Data Storage

- [ ] Define InsForge database schema for storing:
  - Campaign records (brief, params, results, status)
  - Generated creatives (image URLs, concept metadata)
  - Agent run logs (which agent, input hash, output, timestamps)
  - Approval trail (human decisions on agent recommendations)
- [ ] Implement InsForge API calls for CRUD on campaigns and creatives
- [ ] Ensure campaign history is queryable (for the "reopen campaign" flow)

---

## Phase 4: Demo Prep — Caching (3:00-3:30)

- [ ] For each of the 3 sample products, run the full pipeline end-to-end:
  1. Research (Researcher + Media Buyer) for each sample
  2. Generate creatives for the top-3 boards per sample
  3. Save all outputs to `data/cache/<sampleId>/*.json` and `/public/cache/<sampleId>/*.png`
- [ ] Eyeball the Spanish copy on the Mission board:
  - If it reads like Google Translate, regenerate with the Spanglish prompt nudge
  - Native SF Mission Spanglish is acceptable; avoid direct translation
- [ ] Verify cached outputs match the expected contract shapes exactly
- [ ] Prep answers for data Q&A:
  - Sources: AdQuick, Blip, Census, DataSF, SF Planning permits
  - Why numbers are plausible (provenance file proves it)
  - Roadmap: live inventory APIs (schema already matches what they return)

---

## Phase 5: Rehearsal (3:30-4:00)

- [ ] Participate in dry-runs with Steven and Noriaki
- [ ] Watch specifically for:
  - demoMatch results looking wrong on stage (flag immediately)
  - Slider reorder not producing the expected pin swap
  - Spanish copy quality on Mission board
  - Photo composite alignment issues (adCorners)
- [ ] Verify all cached outputs load correctly when live API is unavailable

---

## Contract Flag (from data/README.md)

**`awarenessWeight` formula inversion:** The PRD §5 formula `valueScore = ((1-w)*dailyImpressions + w*targetReach*3)/weeklyCostUsd` makes `w=1` weight targetReach (targeted), but `awarenessWeight=1` is documented as "pure awareness."

The data is tuned to the **documented field meaning** (w=1 = awareness = raw impressions per dollar):
```
valueScore = (w*dailyImpressions + (1-w)*targetReach*3) / weeklyCostUsd
```

**Coordinate with Noriaki:** Backend must use this corrected formula, or frontend must pass `w = 1 - awarenessWeight`. Pick one and confirm in team chat.

---

## Q&A Role

Godson answers: data sourcing (AdQuick, Blip, Census, DataSF, SF Planning permits), why numbers are plausible, provenance file, Nimble integration and what live intelligence it provides, roadmap to live inventory APIs, GMI Cloud model selection rationale.
