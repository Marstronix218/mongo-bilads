# Bilads — PRD v4 (final)

### "Billboards, decided."

**Hackathon MVP · 4 hours · Steven (frontend/demo driver) · Godson (data) · Noriaki (backend)**

---

## 1. Product & framing

**Bilads** is an AI agent team that, from a product upload, finds the highest-value SF billboards for a given weekly budget, generates two neighborhood-tailored ad concepts per location (multilingual where the audience warrants it), composites them onto real billboard photos, and simulates the impressions/conversion payoff over the campaign duration the user picks.

**Category framing:** _An AI agent product that happens to do billboards._ This is the frame for everything — the pitch, the UI, the Q&A. Don't sell it as adtech; sell it as an agent product with a killer first vertical. Judges are betting on the agent architecture generalizing (transit next, then digital OOH, then multi-city). Billboards is the wedge, not the ceiling.

**Positioning vs. Caasie:** Caasie sells the billboard. Bilads decides which one, designs the ad, and shows the ROI.

**Target user:** SF small businesses and small IT/tech companies, first-time or infrequent OOH buyers. Pain we remove: _"I want the best location I can afford — I don't know which board that is or what to put on it."_

**Tagline:** Billboards, decided.

---

## 2. The pitch (Steven drives)

Two minutes, then Q&A. Steven drives the laptop; Godson and Noriaki answer questions on data and agent architecture.

**Open with the problem, not the tagline.** Approx script — adapt in your own voice:

> _"Buying a billboard today is broken. If you're a small SF business, you don't know which of the hundreds of boards is right for you, you can't afford an agency to figure it out, and Caasie will happily sell you any of them. So we built Bilads — an AI agent product that happens to do billboards."_
> _(Click sample product → agent theater runs → map with top 3 → open Mission → English + Spanish concepts → drag slider → live regenerate → simulation animation.)_
> _"Billboards, decided."_

Landing note the tagline at the end, not the start.

---

## 3. Locked scope (v4)

| Decision                | Choice                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium / city           | Physical billboards · San Francisco only                                                                                                                                                                                        |
| Category framing        | AI agent product; billboards is the first vertical                                                                                                                                                                              |
| Buyer persona           | SF small business / small IT company, first-time or infrequent OOH buyer                                                                                                                                                        |
| Inputs                  | Product image + brief (name, description, audience) + weekly budget + campaign duration + awareness↔targeted slider. **Sample products** on the landing page (Volt e-bikes, a local coffee shop, a SaaS) — one-click to prefill |
| Budget below all boards | Warn but let them run; results page shows an empty state with "raise budget to $X to unlock N boards"                                                                                                                           |
| Ranking metric          | Deterministic blend of impressions-per-dollar and target-demo reach-per-dollar via the slider; LLM writes reasons only                                                                                                          |
| Ranked list             | **Top 3 only**, no expander                                                                                                                                                                                                     |
| Results layout          | **Map-first**: fullscreen SF map, 3 pins, one info card floats over the map for the pin you click. No side list.                                                                                                                |
| Selection               | **One board at a time.** Click pin → info card → "Design ads" → creative panel opens for that board. Back to map for the next.                                                                                                  |
| Agent presentation      | Visible 3-agent team (Researcher → Media Buyer → Creative Director); **silent JSON handoffs**, no cross-agent chatter; **no disagreement / retry theater**                                                                      |
| Media Buyer chattiness  | Explains top-3 reasoning out loud (streamed findings + per-board reason); no worst-pick callout in the UI (keep the Sunset low-score in the data, just don't feature it)                                                        |
| Creatives               | 2 concepts per location, neighborhood-tailored by default with "consistent brand" toggle. English + Spanish when `spanishFriendly: true`                                                                                        |
| Composite               | Ads perspective-warped onto real photos                                                                                                                                                                                         |
| Simulation              | Impressions + estimated cost-per-conversion (no full revenue funnel). **Animated over the user-picked duration** — Day 1, Day 2, … impressions and reach growing on a small time-series chart.                                  |
| Data                    | Pre-scraped curated JSON. No live scraping                                                                                                                                                                                      |
| Stack                   | Next.js full-stack, localhost · GMI Cloud (OpenAI-compatible) for LLM + image gen                                                                                                                                               |
| Presentation mode       | **Hybrid**: live upload (or sample click) → cached AI outputs → **live regenerate** at the end                                                                                                                                  |

---

## 4. Visual identity

Bold, high-contrast, ad-industry vibe. Judges should feel this is _a product about billboards_, not another AI dashboard.

- **Palette:** near-black `#0B0B0B` bg · warm off-white `#F5F1E8` text · electric yellow `#F5D400` accent (CTAs, agent activity, score badges) · muted grey `#2A2A2A` surfaces.
- **Type:** oversized display sans for wordmark and headlines (Inter Display / Space Grotesk / Anton); mono (JetBrains Mono / IBM Plex Mono) for agent findings, numbers, and score badges.
- **Layout:** big type, thick horizontal rules, generous whitespace. Score badges styled like billboard corner tabs.
- **Motion:** typewriter reveals for agent findings, count-ups for numbers, "poster paste" transition when a creative composites onto a board, day-by-day animation on the simulation chart.

Tailwind + one Google Font import. Steven spends ≤ 30 min total on styling — the boldness comes from restraint.

---

## 5. The agent team

Three sequential GMI LLM calls with distinct personas. Presented as a visible team of three cards that light up in order and stream findings. **Handoffs are silent JSON** — the next agent's card just activates. No cross-agent commentary, no disagreements, no retries visible on screen. Failure paths fall back deterministically without ever showing the failure to the user.

**Agent 1 — The Researcher** 🔍

- Input: brief + product image (vision if available; else text-only).
- Output JSON: `{ audienceProfile: {ageRange, income, interests, mindset}, buyingTriggers: [3], adToneGuidance, findings: [4 short strings] }`

**Agent 2 — The Media Buyer** 📍

- Input: Researcher output + full `billboards.json` + `weeklyBudgetUsd` + `awarenessWeight ∈ [0,1]`.
- Deterministic scoring per board:
    - `demoMatch ∈ [0,1]` = Jaccard overlap of `audienceProfile.interests` and board's `audienceTags`
    - `targetReach = dailyImpressions × demoMatch`
    - `valueScore = ((1 − w) × dailyImpressions + w × targetReach × 3) / weeklyCostUsd`
- LLM writes the per-board `reason` (≤15 words) and `findings` for the UI. **Rankings are math**, not vibes — stable, explainable, resilient to LLM failure.
- Output JSON: `{ rankings: [{id, score, demoMatch, reason, inBudget}, ... all boards sorted], top3: [ids of top 3 in-budget], findings: [4] }`. Return **all** boards so slider/budget changes re-filter client-side without a new API call.

**Agent 3 — The Creative Director** 🎨

- Runs when the user opens a board. Produces **2 concepts** in one call.
- Input: brief + audienceProfile + board's `neighborhood`, `audienceTags`, `trafficType`, `spanishFriendly`, plus `consistentBrand: boolean` and `variant: number`.
- Language rule: `spanishFriendly === true` → one concept English, one Spanish. Else two distinct English angles.
- `consistentBrand === true` → both concepts stay on-brand across boards (fixed tone, similar palette); else neighborhood-tailored.
- Output JSON: `{ concepts: [{id, language, headline (≤7 words), subline (≤10 words), imagePrompt, rationale (≤15 words)}, {...}] }`
- Then two parallel GMI image-gen calls at wide ratio (1024×512 or nearest). **Text is never in the image** — HTML overlays only. Reasons: image models garble text; overlays let us swap language/copy instantly without a new image call.

**JSON hygiene (all agents):** JSON-only prompt, strip code fences, `JSON.parse` in try/catch, one silent retry with "return only valid JSON", then deterministic fallback (fallback scorer for Media Buyer; canned copy templates for Creative Director). App never dead-ends, user never sees the failure.

---

## 6. User flow

1. **Landing** — `BILADS` wordmark, tagline underneath, upload panel with:
    - Product image drop
    - Name, description, target audience
    - Weekly budget ($)
    - Campaign duration (weeks, default 4)
    - Awareness ↔ Targeted slider
    - **Three sample product cards** below the form — click any to prefill everything (Volt e-bikes, Fog City Coffee, Ledgerly SaaS). Sample cards double as demo-safety net and range-of-use signaling.
    - "Deploy agent team" CTA
2. **Agent theater** — three cards light up in order; each streams 4 findings via typewriter (findings arrive in one response, frontend paces the reveal). Silent handoffs — a card just activates when the previous finishes. This is the moment.
3. **Results page — fullscreen map**:
    - SF map (react-leaflet + OSM tiles + `leaflet.heat`) with 3 pins for top-3 in-budget boards
    - Sticky top bar: budget input + slider + duration input, all editable, changes re-filter and re-rank client-side and re-drop the pins
    - Click a pin → floating info card over the map with: rank badge, name, weekly cost, `demoMatch %`, Media Buyer reason, "Design ads" button
    - Below-budget empty state: full-screen message _"Your $X budget doesn't cover any boards. Raise to $Y to unlock 3 options."_ with a nudge slider.
4. **Design ads** → creative panel slides in over the map (or full-page — Steven's call): two concept cards side-by-side, both perspective-composited onto the real billboard photo with headline/subline overlaid in the Bilads display font. Mission board shows English + Spanish — Steven calls this out on stage. "Regenerate" per card. "Consistent brand" toggle at top. "Back to map" to try another board.
5. **Simulate** button on the creative panel → animation runs: over the user's picked duration (say 4 weeks = 28 days), a small time-series chart draws day-by-day impressions and target-demo reach, a running counter shows cumulative impressions and estimated cost-per-conversion. Total campaign spend, blended CPM, and est. CPA land at the end. Assumptions in small mono type.
6. **Live regenerate** at the demo's end — same endpoint, `variant++`, ~8s. Proves the pipeline is real. If it fails, silently swap to a pre-cached second variant with the same button (the button worked, that's what matters).

---

## 7. Contracts (Godson writes `types.ts` from this section)

This section is the **single source of truth** for every boundary in the app — API request/response shapes, data files, and shared enums. Godson writes `types.ts` from this, everyone imports from it. If reality diverges from this section, update this section first, then the code.

Rules for the contract itself:

- All shared types live in `types.ts` at the repo root
- Enums are string unions (no TS `enum`), for tree-shakability and JSON parity
- Every field has an explicit type; no `any`
- Nothing optional unless the spec says so
- Field names below are **exact** — do not rename in code

### 7.1 Shared domain types

```ts
// Language codes we support in ad copy
export type Language = "en" | "es";

// What kind of traffic passes the board
export type TrafficType = "vehicle" | "foot" | "foot+vehicle";

// User-facing brief (form state on the landing page)
export interface ProductBrief {
    productName: string;
    description: string;
    audience: string; // free-text target audience
    imageBase64?: string; // product image, optional
}

// Campaign parameters set on the landing page alongside the brief
export interface CampaignParams {
    weeklyBudgetUsd: number; // e.g. 3000
    campaignWeeks: number; // integer, default 4
    awarenessWeight: number; // 0..1, 0 = pure targeted, 1 = pure awareness
}

// The Researcher agent's understanding of who to advertise to
export interface AudienceProfile {
    ageRange: string; // "25-40"
    income: string; // "$60k-$120k"
    interests: string[]; // tags used for demoMatch (Jaccard vs board tags)
    mindset: string; // one short sentence
}
```

### 7.2 `POST /api/research`

Runs Researcher then Media Buyer server-side; returns both blocks in one response. Client animates them sequentially.

```ts
export interface ResearchRequest {
    brief: ProductBrief;
    campaign: CampaignParams;
}

// One item per board, all boards included, sorted by valueScore desc
export interface BoardRanking {
    id: string; // matches Billboard.id
    score: number; // valueScore, deterministic (see §5)
    demoMatch: number; // 0..1, Jaccard(audienceProfile.interests, board.audienceTags)
    reason: string; // ≤ 15 words, LLM-written
    inBudget: boolean; // board.weeklyCostUsd <= campaign.weeklyBudgetUsd
}

export interface ResearchResponse {
    researcher: {
        audienceProfile: AudienceProfile;
        buyingTriggers: string[]; // exactly 3
        adToneGuidance: string; // one paragraph
        findings: string[]; // exactly 4, for typewriter reveal
    };
    mediaBuyer: {
        rankings: BoardRanking[]; // ALL boards, sorted
        top3: string[]; // first 3 board ids where inBudget === true
        findings: string[]; // exactly 4
    };
}
```

### 7.3 `POST /api/generate`

Runs Creative Director once, produces two concepts, generates two images in parallel.

```ts
export interface GenerateRequest {
    billboardId: string;
    brief: ProductBrief;
    audienceProfile: AudienceProfile;
    consistentBrand: boolean; // true = same visual identity across boards
    variant?: number; // increments on Regenerate, default 0
}

export interface AdConcept {
    id: string; // stable within a response, e.g. "concept-0"
    language: Language;
    headline: string; // ≤ 7 words
    subline: string; // ≤ 10 words
    imageUrl: string; // /public path or full URL to the generated ad art
    rationale: string; // ≤ 15 words, why this concept for this board
}

export interface GenerateResponse {
    concepts: AdConcept[]; // exactly 2
}
```

### 7.4 Billboard data — `data/billboards.json`

Array of the shape below, 12–15 entries. This is the input to the Media Buyer and the source for map pins, info cards, and creative composites.

```ts
export interface Billboard {
    id: string; // slug, e.g. "sf-mission-24th"
    name: string; // human-readable, e.g. "24th St @ Mission"
    lat: number;
    lng: number;
    photo: string; // "/billboards/<id>.jpg"
    adCorners: [
        // TL, TR, BR, BL pixel coords of blank board in photo
        [number, number],
        [number, number],
        [number, number],
        [number, number],
    ];
    dailyImpressions: number;
    trafficType: TrafficType;
    avgDwellSeconds: number;
    weeklyCostUsd: number;
    neighborhood: string; // e.g. "Mission"
    spanishFriendly: boolean; // triggers EN+ES concepts
    audienceTags: string[]; // used for demoMatch
    demographics: {
        medianAge: number;
        medianIncome: number;
        footTrafficDaily: number;
        hispanicSharePct: number;
    };
}
```

### 7.5 Sample products — `data/samples.ts`

```ts
export interface SampleProduct {
    id: string; // "volt" | "fog-city" | "ledgerly"
    label: string; // "Volt E-Bikes"
    brief: ProductBrief;
    campaign: CampaignParams; // suggested defaults for this sample
    productImagePath: string; // "/samples/volt.png"
}

export const SAMPLES: SampleProduct[]; // exactly 3
```

Clicking a sample card sets the entire landing-page form state to `{...sample.brief, ...sample.campaign}` and previews `productImagePath` in the image drop zone.

### 7.6 Traffic heatmap — `data/traffic-heatmap.json`

```ts
// Feed directly to leaflet.heat's addLayer
export type HeatmapPoint = [lat: number, lng: number, intensity: number];
export type HeatmapData = HeatmapPoint[]; // 200–400 points
```

### 7.7 Simulation (client-only, no API)

Pure function over selected concepts and their boards. Not an API contract, but Godson should still type it so Steven doesn't reinvent it.

```ts
export interface SimulationInput {
    boards: Billboard[]; // one per selected concept
    demoMatches: number[]; // parallel array, same length
    campaignWeeks: number;
    assumedOrderValueUsd?: number; // default 1800 (Volt e-bike order)
}

export interface DailyPoint {
    day: number; // 1..(campaignWeeks*7)
    impressions: number;
    targetReach: number;
    cumImpressions: number;
    cumTargetReach: number;
}

export interface SimulationOutput {
    days: DailyPoint[];
    totalImpressions: number;
    totalSpendUsd: number;
    blendedCpmUsd: number;
    estimatedConversions: number;
    estimatedCpaUsd: number; // costPerConversion
    assumptions: string[]; // rendered in the mono footer
}
```

Formulas (per §5, restated here so the type file can carry them as comments):

- `dailyImpressions_d = board.dailyImpressions × (0.9 + Math.random() × 0.2)`
- `reach = cumImpressions × 0.6`
- `targetReach = reach × demoMatch`
- `conversions = targetReach × 0.0005`
- `costPerConversion = (Σ board.weeklyCostUsd × campaignWeeks) / conversions`

### 7.8 Contract change protocol

- Anyone can propose a change; only one person merges it (Godson).
- If a change is needed after minute 30, both consumers of the type (frontend and backend) must acknowledge in team chat before Godson merges — prevents silent breakages during the crunch.

---

## 8. Data spec (Godson)

`data/billboards.json` — 12–15 boards. Schema:

```json
{
  "id": "sf-mission-24th",
  "name": "24th St @ Mission",
  "lat": 37.7525, "lng": -122.4183,
  "photo": "/billboards/sf-mission-24th.jpg",
  "adCorners": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]],
  "dailyImpressions": 38000,
  "trafficType": "foot+vehicle",
  "avgDwellSeconds": 8,
  "weeklyCostUsd": 1400,
  "neighborhood": "Mission",
  "spanishFriendly": true,
  "audienceTags": ["25-40", "latino", "nightlife", "creatives", "commuters"],
  "demographics": { "medianAge": 34, "medianIncome": 76000, "footTrafficDaily": 22000, "hispanicSharePct": 38 }
}
```

Curate for range across the three sample products (Volt / coffee / SaaS):

- **101 N @ Vermont (SoMa)** — huge impressions, tech commuters, mid-high price → wins Volt awareness mode + SaaS
- **280 @ Daly City approach** — commuter, cheaper
- **Market St downtown** — office workers, mid price → wins SaaS targeted
- **24th St @ Mission** — `spanishFriendly: true`, cheaper → the multilingual moment
- **Marina / Chestnut St** — affluent, fitness, higher price → wins Volt targeted
- **Valencia St (Mission)** — creatives/nightlife → wins coffee shop
- **Hayes Valley** — walkable, foodie → wins coffee shop
- **Sunset or Richmond** — families, deliberately low `demoMatch` for Volt (stays in the data; not featured in UI)
- 3–5 more for price/tag range

Also `data/traffic-heatmap.json` — 200–400 weighted `[lat, lng, intensity]` points along 101 / 280 / Market / Mission / Marina, via a 20-line script sampling points along polylines.

Also `data/samples.ts` — three sample product briefs (Volt, Fog City Coffee, Ledgerly) with prewritten name/description/audience/budget/duration, plus a pre-generated product image path.

---

## 9. Hour-by-hour plan

| Time      | Steven (frontend / demo driver)                                                                                                                                                                       | Godson (data)                                                                                                                  | Noriaki (backend)                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Scaffold Next.js repo; commit `types.ts` with both contracts; Tailwind + font                                                                                                                         | GMI playground: pick LLM (vision if possible) + image model; note model IDs                                                    | Pair with Godson on GMI; `lib/gmi.ts` OpenAI-compatible client                                                                    |
| 0:15–1:00 | Landing: wordmark, tagline, upload form (image + brief + budget + duration + slider), **3 sample cards** wired to prefill; agent-card components fed by mocks                                         | `billboards.json` v1 (8 boards incl. Mission + Marina + 101); collect photos                                                   | `/api/research` returning hardcoded mock matching contract                                                                        |
| 1:00–2:00 | Agent theater (typewriter, silent handoffs); results page: fullscreen map + pins + sticky top bar (budget/slider/duration re-filter client-side); floating info card on pin click                     | Annotate `adCorners`; heatmap script; `spanishFriendly` + `hispanicSharePct` fields; write `samples.ts` (Volt / Coffee / SaaS) | Wire real Researcher + Media Buyer (deterministic math + LLM reasons); JSON parse + retry + fallback scorer                       |
| 2:00–3:00 | Creative panel: 2 concept cards, perspective composite, text overlay in display font; "consistent brand" toggle; "Regenerate" per card                                                                | Finish 12–15 boards; sanity-check `demoMatch` across all 3 sample products by hand                                             | `/api/generate` (Creative Director + 2 parallel image calls); `variant` + `consistentBrand` support; disk cache for all 3 samples |
| 3:00–3:30 | Simulation: day-by-day animated chart + count-ups + total CPA; empty state for under-budget; polish typography                                                                                        | Pre-run pipelines for all 3 samples at target budget + slider positions; commit cached outputs                                 | Fallback wiring: any AI call > 20s or error → cached result; ensure live regenerate hits real endpoint                            |
| 3:30–4:00 | **Everyone:** two full dry-runs of the 2-min demo including: sample click → agent theater → slider drag → Mission Spanish reveal → simulation animation → live regenerate. Fix only breakage. Freeze. |                                                                                                                                |                                                                                                                                   |

## 10. Detailed task lists

Checklists complement §9's timeline — the table is _when_, this is _what_. Each task is scoped so any one item takes ≤ 20 min. Check them off as you go. Every task references a section for the spec.

### Steven — frontend & demo driver

**Setup (0:00–0:15)**

- [ ] `npx create-next-app@latest bilads --typescript --tailwind --app` — pick defaults
- [ ] Install: `leaflet react-leaflet leaflet.heat perspective-transform openai` (openai package used against GMI base URL)
- [ ] Create `types.ts` with both API contracts from §7 — commit and share the path in team chat
- [ ] Add Google Font import to `app/layout.tsx`: Space Grotesk (display) + JetBrains Mono. Extend Tailwind theme with the §4 palette (`#0B0B0B`, `#F5F1E8`, `#F5D400`, `#2A2A2A`) as named tokens (`bg`, `fg`, `accent`, `surface`).

**Landing page (0:15–1:00)**

- [ ] `app/page.tsx`: `BILADS` wordmark top-left at hero size; tagline "Billboards, decided." in display font under it
- [ ] Upload form component: image drop zone + 3 text inputs (name, description, audience) + weekly budget ($) input + campaign duration (weeks, default 4) + awareness↔targeted slider (0–1, default 0.5)
- [ ] "Deploy agent team" CTA in accent yellow
- [ ] Three sample product cards row under the form — reads from `data/samples.ts`, one click prefills the entire form and scrolls to the CTA
- [ ] Agent card component (`<AgentCard name status findings />`) — used 3× on the next screen; build against mocks now

**Agent theater (1:00–2:00)**

- [ ] `app/results/page.tsx` shell; on mount, POST to `/api/research` with form state (accept mock response for now)
- [ ] Sequential card activation: card 1 goes "active" immediately, streams Researcher findings via typewriter (paced reveal from the `findings[]` array, ~120ms per char); on completion, card 2 activates and streams Media Buyer findings; then card 3 waits (Creative Director doesn't run until a board is opened)
- [ ] No cross-agent commentary; silent handoff (card 1 dims to "complete", card 2 lights up)

**Results page — map + info card (1:00–2:00, overlaps above)**

- [ ] Fullscreen react-leaflet map centered on SF, OSM tiles, `leaflet.heat` layer off by default
- [ ] Pin component for top-3 boards from `mediaBuyer.top3` — pin shows rank number in a yellow badge
- [ ] Sticky top bar: budget input + slider + duration input, all bound to state; changing any re-filters `mediaBuyer.rankings` client-side to new top 3 (recompute `valueScore` with new `w` per §5) and re-drops pins with a smooth transition
- [ ] Click pin → floating info card over the map with: rank badge, name, weekly cost, `demoMatch %`, Media Buyer `reason` from the rankings array, "Design ads" button
- [ ] Empty state: if `top3` is empty because budget is too low, full-screen message per §6 with the raise-budget nudge

**Creative panel (2:00–3:00)**

- [ ] On "Design ads" click, slide-in panel (or full-page — your call) over the map; POST to `/api/generate` with `{billboardId, brief, audienceProfile, consistentBrand, variant: 0}`
- [ ] Two concept cards side-by-side, each showing: real billboard photo with the generated ad perspective-warped onto the board using `perspective-transform` npm to compute `matrix3d` from that board's `adCorners`, then CSS transform applied to an `<img>` of the generated ad
- [ ] Headline + subline overlaid in display font over the composited ad; language badge (EN/ES) top-right
- [ ] Per-card "Regenerate" button → same endpoint with `variant++` (local counter per card)
- [ ] "Consistent brand" toggle at panel top — re-fires generate for both concepts when flipped
- [ ] "Back to map" button

**Simulation (3:00–3:30)**

- [ ] "Simulate campaign" button in the creative panel → animation over user's picked duration (default 28 days for 4 weeks)
- [ ] Small time-series chart (SVG or a tiny recharts area chart) drawing daily impressions and target-demo reach day by day, ~80ms/day (whole animation ~2.2s)
- [ ] Below the chart, count-ups for: total impressions, total spend, blended CPM, est. CPA per §7
- [ ] Assumptions in mono footer

**Rehearsal (3:30–4:00)**

- [ ] Wire up cached AI outputs from Noriaki so live pipeline is bypassed when `?cached=1` or a "demo mode" flag is set
- [ ] Two full dry-runs of the 2-min flow: sample click → agent theater → slider drag → open Mission → English + Spanish reveal → simulate animation → live regenerate on one card
- [ ] Confirm the fallback: kill wifi, hit regenerate, ensure the second cached variant swaps in silently

---

### Godson — data

**Setup (0:00–0:15)**

- [ ] Log into GMI Cloud playground; confirm API key works
- [ ] Pick one LLM (test whether it's vision-capable by uploading an image with a text prompt — if it returns coherent description, we can use vision; if not or too slow, we go text-only)
- [ ] Pick one image model (test with `"wide-format billboard ad for e-bike, urban commuter tone, no text, 1024x512"`); confirm quality + latency
- [ ] Post exact model IDs to team chat and paste them into `lib/gmi.ts` constants

**Billboards dataset v1 (0:15–1:00)**

- [ ] Create `data/billboards.json` with 8 boards to unblock backend + frontend: 101 N @ Vermont (SoMa), 280 approach, Market St downtown, 24th St @ Mission (spanishFriendly: true), Chestnut St (Marina), Valencia St (Mission), Hayes Valley, Sunset (deliberate low-fit for Volt)
- [ ] Schema exactly per §8 — all fields required including `demographics.hispanicSharePct`, `spanishFriendly`, `audienceTags`
- [ ] Numbers from AdQuick / Blip / Caasie listings + Census/DataSF eyeball — plausible beats precise
- [ ] Collect one photo per board: Street View screenshots are fine; must have a big, front-facing rectangular board visible

**Annotation + heatmap (1:00–2:00)**

- [ ] Save photos as `/public/billboards/<id>.jpg`
- [ ] For each photo: open in any image editor, note the 4 pixel corners of the blank board area (TL, TR, BR, BL order), write into `adCorners`
- [ ] Sanity check: pick one photo + corners, hand it to Steven for a quick composite test before annotating the rest
- [ ] Write `scripts/gen-heatmap.mjs`: sample 200–400 weighted `[lat, lng, intensity]` points along polylines for 101 / 280 / Market / Mission / Marina. Output `data/traffic-heatmap.json`. 20 lines of code.
- [ ] Create `data/samples.ts` with three prewritten briefs (Volt e-bikes, Fog City Coffee, Ledgerly SaaS) — each with name, description, audience, weeklyBudgetUsd, campaignWeeks, awarenessWeight, and `productImagePath` pointing to a pre-generated image in `/public/samples/`

**Finalize dataset (2:00–3:00)**

- [ ] Expand to 12–15 boards; ensure price/tag range across all three sample products (a Volt-winner in awareness mode, a Volt-winner in targeted mode, a coffee-winner, a SaaS-winner)
- [ ] Manual demoMatch sanity check: for each sample brief, mentally rank the boards and compare to Jaccard(audienceProfile.interests, board.audienceTags) — if the winners are surprising, adjust `audienceTags`, not the math

**Demo prep (3:00–3:30)**

- [ ] For each of the 3 sample products, run the full pipeline end-to-end (research → generate for the top 3 boards) and save outputs to `data/cache/<sampleId>/*.json` and `/public/cache/<sampleId>/*.png` — this is the hybrid demo's safety net
- [ ] Eyeball the Spanish copy on the Mission board: if it reads like Google Translate, ask Creative Director to regenerate with the Spanglish prompt nudge
- [ ] Prep answers for data Q&A: sources (AdQuick, Blip, Census, DataSF), why numbers are plausible, roadmap to live inventory APIs

**Rehearsal (3:30–4:00)**

- [ ] Participate in dry-runs; watch specifically for demoMatch results looking wrong on stage and flag before the pitch

---

### Noriaki — backend

**Setup (0:00–0:15)**

- [ ] Pair with Godson on GMI playground; confirm auth + latency
- [ ] Create `lib/gmi.ts`: exports an `openai` client configured with GMI's baseURL and the API key from `.env.local`; exports two helpers, `chat(messages, model)` and `image(prompt, model)`. Model IDs come from Godson.
- [ ] Add `.env.local` with `GMI_API_KEY`; add to `.gitignore` (never commit keys)

**Research endpoint — mock first (0:15–1:00)**

- [ ] Create `app/api/research/route.ts` — POST handler
- [ ] Return hardcoded mock matching the `types.ts` contract from §7 (Researcher block + Media Buyer block with rankings for the 8 boards + findings arrays). This unblocks Steven's whole agent theater and results page.
- [ ] Steven should be able to run the full frontend against this mock by 1:00

**Research endpoint — real agents (1:00–2:00)**

- [ ] Implement Researcher call per §5: system prompt asking for strict JSON, user message with brief + optional image. Model: chosen LLM.
- [ ] Implement `parseJsonStrict(text)` util: strip ```json fences, JSON.parse in try/catch, one retry with "return only valid JSON — no prose, no code fences", then throw
- [ ] Implement Media Buyer per §5: **deterministic ranking math first** (`demoMatch` via Jaccard, `valueScore` formula), then one LLM call whose only job is to produce per-board `reason` strings and 4 `findings`. Merge into rankings; `inBudget = weeklyCostUsd ≤ weeklyBudgetUsd`; `top3` = first 3 where `inBudget` after sorting by `valueScore` desc.
- [ ] Deterministic fallback path: if the Media Buyer LLM call fails or returns bad JSON, still return the ranking + a canned reason template like `"Strong match on {top-3 overlapping tags}."` — the app never dead-ends.

**Generate endpoint (2:00–3:00)**

- [ ] `app/api/generate/route.ts` — POST handler; validate body; load board from `billboards.json`
- [ ] One LLM call: Creative Director prompt per §5; instruct it to return `concepts[]` with 2 items; enforce language rule based on `spanishFriendly`; inject `variant` and `consistentBrand` into the prompt (`variant=2` → "concept #2, use a different visual metaphor and color palette than concept #1"; `consistentBrand=true` → "keep visual identity consistent across neighborhoods")
- [ ] Parse response with `parseJsonStrict`; then fire **two parallel** GMI image calls with each concept's `imagePrompt` at 1024×512 (or nearest supported); return `{concepts: [{..., imageUrl}, {...}]}`
- [ ] Disk cache: hash `(billboardId, sampleId, variant, consistentBrand)` → save results to `data/cache/`; on subsequent identical calls, return from cache

**Fallback + timeout (3:00–3:30)**

- [ ] Wrap every GMI call with `Promise.race([call, timeout(20000)])`; on timeout OR any thrown error in the generate endpoint, load the pre-cached result for the current `sampleId + billboardId` (Godson will have committed these); if no cached result exists, use canned copy templates + a placeholder image path
- [ ] Add a `?live=1` query param that bypasses the cache — Steven uses this for the on-stage regenerate moment
- [ ] Confirm end-to-end: with wifi off, both endpoints still return valid data

**Rehearsal (3:30–4:00)**

- [ ] Two dry-runs with Steven and Godson: verify cached path is silent on failure, verify the live regenerate hits the real endpoint and returns in < 12s
- [ ] Prep answers for architecture Q&A: three-agent design, deterministic ranking vs. LLM reasoning, why GMI (OpenAI-compat API, one integration for LLM + image), roadmap (multi-vertical: same architecture for transit/DOOH)

---

## 11. Cut list (in order)

1. Consistent-brand toggle (default to tailored)
2. Sample products 2 & 3 (keep Volt)
3. Simulation animated over duration → static count-up numbers
4. Second concept per location → 1 concept
5. Live regenerate → hide the button
6. Heatmap layer → pins only
7. Empty-state UX → any budget lands on 3 boards

**Never cut** — sample click → agent theater → fullscreen map with 3 pins + reasons → open Mission board → English + Spanish concepts composited on the photo → some numbers. That chain is the pitch.

## 12. Risks

- **GMI latency/failure on stage** → hybrid demo: everything cached across all 3 samples; live path is only the final regenerate. If regenerate fails, silently swap to a second cached variant.
- **Malformed LLM JSON** → strict-JSON prompt, fence-strip, one silent retry, then deterministic fallback.
- **Regenerate returns near-identical ad** → `variant` counter + "different visual metaphor / different color palette" nudge; rehearse which card to regenerate.
- **Spanish copy sounds unnatural** → prompt Creative Director with "native SF Mission Spanglish is acceptable; avoid direct translation." Eyeball before demo.
- **Judges ask "why not just use Meta Ads?"** → _"Because a billboard isn't clickable. The whole problem is deciding where and what — that's the agent's job. Bilads exists because OOH lacks the feedback loop digital ads have; we're synthesising it."_
- **Judges ask "is this real data?"** → _"Curated from AdQuick, Blip and Census/DataSF. The agent architecture is designed to plug into live inventory APIs post-hackathon."_ Godson takes this one.
- **Scope creep** — if it isn't in §6's six steps, it doesn't exist today.

## 13. Judge-facing talking points

1. **The category framing.** "An AI agent product that happens to do billboards." Billboards is the wedge; the architecture generalizes.
2. **The problem opener.** Buying a billboard as a small business is broken — no data, no design, no agency budget.
3. **The tagline is the closer.** "Billboards, decided." Land it, then take questions.
4. **The slider is the differentiator.** Drag Awareness → Targeted on stage — rankings visibly reorder. Zero API calls. That's the product in one gesture.
5. **The Mission bilingual moment.** "Same board, two concepts, one in Spanish — 38% of that neighborhood is Latino. Nobody else is doing this at the ad level."
6. **The live regenerate.** "Everything you saw was cached for speed — watch this one run live." Click. Wait 8s. Land the plane.
7. **Roles in Q&A.** Godson: data & sourcing. Noriaki: agent architecture & GMI. Steven: product & demo.
