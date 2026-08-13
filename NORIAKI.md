# Noriaki — Backend & Agent Architecture

**Role:** API endpoints, agent logic, GMI Cloud client, BAND/Kylon/InsForge backend integration.

> **Status (2026-07-13, branch `noriaki`)** — all code phases implemented and verified offline:
> `lib/gmi.ts` (20s-timeout chat+image), `/api/research` (mock via `?mock=1` + real agents +
> deterministic fallback; Nimble signals injected, `[Nimble] `-prefixed findings for badges),
> `/api/generate` (Creative Director → 2 parallel images → disk cache in `data/cache/`,
> `?live=1` bypass, canned+placeholder fallback), `/api/band`, `/api/kylon`, `lib/insforge.ts`
> (in-memory fallback when unconfigured). Scoring uses the **corrected formula** below; all three
> samples reproduce data/README.md's expected top-3 table. `scripts/warm-cache.mjs` pre-warms the
> demo cache once a key exists.
>
> **Still blocked on humans:** GMI key + model IDs from Godson (then verify live round-trip and
> run warm-cache), formula confirmation in team chat (§7.8), InsForge credentials (offline
> fallback active until then), and the Phase-6 rehearsal.

Noriaki owns everything behind the API: the three-agent pipeline, deterministic scoring, LLM orchestration, fallback paths, caching, and the backend integration of BAND, Kylon, and InsForge.

---

## Phase 0: Setup (0:00-0:15)

- [ ] Pair with Godson on GMI Cloud playground; confirm auth + latency
- [ ] Create `lib/gmi.ts`:
  - Export an `openai` client configured with GMI's `baseURL` and API key from `.env.local`
  - Export two helpers: `chat(messages, model)` and `image(prompt, model)`
  - Model IDs come from Godson
- [ ] Add `.env.local` with `GMI_API_KEY`; add to `.gitignore` (never commit keys)
- [ ] Verify round-trip: one test chat call + one test image call succeed

---

## Phase 1: Research Endpoint — Mock First (0:15-1:00)

- [ ] Create `app/api/research/route.ts` — POST handler
- [ ] Return hardcoded mock matching the `ResearchResponse` contract from `types.ts`:
  - Researcher block: `audienceProfile`, `buyingTriggers[3]`, `adToneGuidance`, `findings[4]`
  - Media Buyer block: `rankings[]` (all 14 boards, sorted by valueScore desc), `top3[]`, `findings[4]`
- [ ] **Steven should be able to run the full frontend against this mock by 1:00**
- [ ] Validate mock shape: every field present, correct types, no optional fields missing

---

## Phase 2: Research Endpoint — Real Agents (1:00-2:00)

### Researcher Agent

- [ ] System prompt: strict JSON output only, no prose, no code fences
- [ ] User message: brief (name, description, audience) + optional image (if vision-capable model)
- [ ] Expected output: `{ audienceProfile, buyingTriggers, adToneGuidance, findings }`
- [ ] Implement `parseJsonStrict(text)` utility:
  - Strip ` ```json ` fences
  - `JSON.parse` in try/catch
  - One silent retry with prompt: "return only valid JSON — no prose, no code fences"
  - Then throw (caller handles fallback)

### Media Buyer Agent

- [ ] **Deterministic scoring math FIRST** (not LLM-dependent):
  ```
  demoMatch = Jaccard(audienceProfile.interests, board.audienceTags)
  targetReach = dailyImpressions * demoMatch
  ```
- [ ] **Formula (use corrected version per data/README.md):**
  ```
  valueScore = (w * dailyImpressions + (1-w) * targetReach * 3) / weeklyCostUsd
  ```
  Where `w = awarenessWeight` (w=1 means pure awareness = raw impressions per dollar)
- [ ] Coordinate with Godson on which formula form to use — confirm in team chat
- [ ] `inBudget = board.weeklyCostUsd <= campaign.weeklyBudgetUsd`
- [ ] Sort all boards by `valueScore` desc
- [ ] `top3 = first 3 board ids where inBudget === true`
- [ ] One LLM call: only job is to produce per-board `reason` strings (<=15 words each) and 4 `findings`
- [ ] **Deterministic fallback:** if LLM call fails or returns bad JSON, still return rankings + canned reason template: `"Strong match on {top-3 overlapping tags}."`
- [ ] App never dead-ends — user never sees failure

### Sponsor: Nimble Integration in Research

- [ ] Accept Nimble signal data (from `data/nimble-signals/`) as additional context for the Research Agent
- [ ] Inject Nimble signals into the Researcher's prompt: nearby businesses, retail density, transit, events, competitor activity
- [ ] Nimble data should demonstrably influence the `audienceProfile.interests` and `findings` output
- [ ] Tag Nimble-sourced findings so the frontend can show "Source: Nimble" badges

---

## Phase 3: Generate Endpoint (2:00-3:00)

- [ ] Create `app/api/generate/route.ts` — POST handler
- [ ] Validate body against `GenerateRequest` from `types.ts`
- [ ] Load board from `billboards.json` by `billboardId`

### Creative Director Agent

- [ ] One LLM call with prompt per PRD §5:
  - Input: brief + audienceProfile + board's neighborhood, audienceTags, trafficType, spanishFriendly
  - `variant` param: `"concept #{variant}, use a different visual metaphor and color palette than previous"`
  - `consistentBrand` param: `"keep visual identity consistent across neighborhoods"`
  - Language rule: `spanishFriendly === true` -> one concept English, one Spanish; else two distinct English angles
- [ ] Expected output: `{ concepts: [{id, language, headline, subline, imagePrompt, rationale}, {...}] }`
- [ ] Parse with `parseJsonStrict`

### Image Generation

- [ ] Fire **two parallel** GMI Cloud image calls with each concept's `imagePrompt` at 1024x512 (or nearest supported)
- [ ] Save images to `/public/generated/` with deterministic filenames
- [ ] Return `{ concepts: [{..., imageUrl}, {...}] }`

### Important: Content Safety

- [ ] Do NOT let the image model invent logos, prices, nutritional claims, testimonials, or location facts
- [ ] Image prompts should specify: "no text overlay, no logos, no claims" — text is added by frontend as HTML overlay
- [ ] Only approved claims from the campaign brief are used

### Disk Cache

- [ ] Hash `(billboardId, sampleId, variant, consistentBrand)` -> save results to `data/cache/`
- [ ] On subsequent identical calls, return from cache immediately
- [ ] This is critical for demo reliability

---

## Phase 4: Sponsor Backend Integration (2:00-3:00)

### BAND — Agent Collaboration Room

- [ ] Create `app/api/band/route.ts` — manages agent discussion state
- [ ] Implement 5-agent BAND room logic:
  | Agent | Role |
  |---|---|
  | Market Research Agent | Posts location findings from Nimble data |
  | Media Planner Agent | Explains channel selection reasoning |
  | Creative Director Agent | States concept rationale and constraints |
  | Performance Analyst Agent | Posts simulation estimates |
  | Risk and Brand Agent | Flags rejected variants with reasons |
- [ ] Each agent produces a structured message: `{ agent, role, message, timestamp, action? }`
- [ ] Risk Agent checks:
  - Unsupported advertising claims
  - Brand consistency
  - Offensive localization
  - Sensitive demographic targeting
  - Unreadable billboard designs (viewing distance vs detail level)
  - Unsuitable placements
- [ ] Human approval step: final decisions require explicit approval before proceeding
- [ ] Store discussion thread so frontend can render it as a conversation

### Kylon — AI Workforce Management

- [ ] Create `app/api/kylon/route.ts` — manages AI employee assignments
- [ ] Track assignment lifecycle:
  1. Research San Francisco campaign locations -> assigned to Research Agent
  2. Produce three media plans -> assigned to Media Planner
  3. Generate creative variants -> assigned to Creative Director
  4. Prepare budget allocation -> assigned to Performance Analyst
  5. Request approval -> triggers BAND room
  6. Create final campaign package -> packaging step
- [ ] Each assignment has status: `pending | in_progress | completed | blocked`
- [ ] Kylon receives company context (brand guidelines, personas, approved claims) and passes to agents
- [ ] **Key distinction:** Kylon = workforce management; BAND = collaborative decision-making

### InsForge — Backend Infrastructure

- [ ] Create `lib/insforge.ts` — InsForge client for:
  - User authentication (login/signup/session)
  - Database operations (campaigns, creatives, agent runs, approvals)
  - File/image storage (product uploads, generated creatives)
  - Agent job state tracking
- [ ] Implement InsForge database tables:
  ```
  organizations, users, brands, products, campaigns,
  target_audiences, candidate_locations, location_signals,
  media_channels, creative_variants, simulations,
  agent_runs, agent_messages, approvals
  ```
- [ ] Campaign CRUD: create, read, update status, list history
- [ ] Store approval trail: every human decision recorded with timestamp and context
- [ ] Campaign history: queryable by user, with full state restoration for "reopen" flow
- [ ] Real-time agent status: track which agent is active, what it's processing

---

## Phase 5: Fallback + Timeout (3:00-3:30)

- [ ] Wrap every GMI call with `Promise.race([call, timeout(20000)])`:
  - On timeout OR any thrown error in generate endpoint: load pre-cached result for current `sampleId + billboardId`
  - If no cached result exists: use canned copy templates + placeholder image path
- [ ] Add `?live=1` query param that bypasses the cache — Steven uses this for the on-stage regenerate moment
- [ ] Confirm end-to-end: with wifi off, both endpoints still return valid data
- [ ] Test the fallback chain:
  1. Live API call (normal path)
  2. Timeout after 20s -> cached result
  3. No cache -> canned template (app never dead-ends)

---

## Phase 6: Rehearsal (3:30-4:00)

- [ ] Two dry-runs with Steven and Godson:
  - Verify cached path is silent on failure (no error UI, no loading stall)
  - Verify live regenerate hits the real endpoint and returns in <12s
  - Verify BAND discussion renders with meaningful agent reasoning
  - Verify Kylon assignments update status correctly
- [ ] Prep answers for architecture Q&A:
  - Three-agent design: Researcher -> Media Buyer -> Creative Director
  - Deterministic ranking vs LLM reasoning (math decides rank, LLM writes the explanation)
  - Why GMI Cloud: OpenAI-compatible API, one integration for both LLM + image gen
  - BAND: agents expose reasoning and conflicts, require human approval
  - Kylon vs BAND distinction: workforce management vs collaborative decision-making
  - InsForge: real SaaS backend, not a scripted prototype
  - Nimble: live market intelligence that changes recommendations
  - Roadmap: multi-vertical (transit, DOOH, multi-city — same architecture)

---

## Critical Technical Decisions

### Formula Alignment (MUST RESOLVE)

The `awarenessWeight` formula naming is inverted in the PRD. Use this corrected form:
```
valueScore = (w * dailyImpressions + (1-w) * targetReach * 3) / weeklyCostUsd
```
Where `w = awarenessWeight` and `w=1` means pure awareness (raw impressions per dollar).

Confirm with Godson and Steven before implementing. If you use the literal PRD §5 formula instead, the frontend must pass `w = 1 - awarenessWeight`.

### JSON Hygiene (All Agents)

- JSON-only system prompts
- Strip code fences from responses
- `JSON.parse` in try/catch
- One silent retry with "return only valid JSON"
- Then deterministic fallback (never dead-end)

### Image Generation Rules

- Text is NEVER in the image — HTML overlays only
- Image models garble text; overlays let us swap language/copy instantly
- Prompts must specify no-text, no-logo constraints

---

## Q&A Role

Noriaki answers: agent architecture (3 agents, sequential, silent handoffs), deterministic scoring formula, GMI Cloud integration (OpenAI-compatible for both LLM + image), BAND multi-agent governance, Kylon workforce management, InsForge backend infrastructure, JSON parsing strategy, fallback/timeout design, roadmap to multi-vertical.
