# Bilads — Product Requirements

**Tagline:** Billboards, decided.

## 1. Product

Bilads is an AI-assisted billboard planning workspace for San Francisco. A buyer provides a product brief, website, image, weekly budget, campaign duration, and an awareness-to-targeting preference. Bilads ranks affordable placements, develops neighborhood-aware creative, places the result into real street scenes, and simulates campaign reach and cost.

The product is positioned as an agent workflow with billboard planning as its first vertical. It serves small businesses and small technology companies that need an explainable answer to two questions: which placement should they buy, and what should the ad say?

## 2. Product principles

- Rankings are deterministic and explainable. Models may describe a result but do not decide placement order.
- The map is the primary planning interface.
- Generated copy and visuals are tailored to the placement and audience.
- A human must explicitly approve creative before an approved campaign briefing can be synthesized as audio.
- The core demo remains usable through deterministic and cached fallbacks when optional live inference is unavailable.
- Production persistence fails closed when Atlas is configured; it must not silently fork into local state.
- Model evaluation is explicit and isolated from the production inference path.

## 3. Scope

| Area | Requirement |
| --- | --- |
| Market | Physical billboards in San Francisco |
| Buyer | Small business or small technology company; no prior out-of-home expertise assumed |
| Inputs | Product name, description, audience, optional product image or website, weekly budget, campaign duration, and awareness/targeting weight |
| Samples | Volt E-Bikes, Fog City Coffee, and Ledgerly are one-click demo inputs |
| Inventory | Curated billboard data grounded in committed location and permit records; no live scraping in the buyer flow |
| Ranking | Deterministic blend of impressions per dollar and target-audience reach per dollar |
| Results | Top three in-budget boards on a map; a below-budget state explains the minimum needed to unlock options |
| Creative | Two concepts for one selected board at a time; English and Spanish when the placement is marked Spanish-friendly |
| Presentation | Generated artwork contains no text; headline and subline are rendered as reliable application overlays |
| Review | Five-agent review room plus an explicit human approval or rejection decision |
| Simulation | Day-by-day impressions, target reach, spend, blended CPM, estimated conversions, and estimated CPA |
| Saved work | Campaigns, research, creative generations, assets, agent runs, decisions, and workflow state are durable |
| Accounts | No login, signup, user accounts, organization membership, or tenant isolation |

## 4. User flow

1. On the landing page, the buyer enters a brief or selects a sample, chooses budget and duration, and sets the awareness/targeting weight.
2. `POST /api/campaigns` creates an idempotent campaign record and stores an uploaded product image when present.
3. `POST /api/research` runs audience research and media buying. The interface reveals the findings as sequential agent activity.
4. The results experience shows the top three affordable placements on a San Francisco map. Budget and targeting controls can update the selection without rerunning inference.
5. The buyer opens one board and calls `POST /api/generate` to create two concepts and artwork. Regeneration increments the variant while retaining the campaign and board context.
6. The review room discusses the creative. The buyer starts a creative-approval workflow and explicitly approves or rejects it.
7. An approved creative can produce a cached campaign briefing through `POST /api/audio`.
8. The simulation animates the campaign over the chosen duration and clearly labels modeled assumptions.

The seller cockpit at `/map` is a separate inventory and advertiser-prospecting experience. Saved campaigns are available at `/campaigns`.

## 5. Agent behavior

### Researcher

The Researcher receives the product brief and optional image. It returns an audience profile, three buying triggers, tone guidance, and four concise findings. Fireworks supplies live chat and vision inference. If live inference fails, a deterministic researcher fallback produces a valid response.

### Media Buyer

The Media Buyer receives the audience profile, billboard inventory, budget, and awareness weight. For each board it calculates audience match, target reach, value score, affordability, and a short explanation. It returns every ranked board plus the top three in-budget IDs so the client can re-filter locally.

The canonical scoring rule remains deterministic:

```text
demoMatch   = audience-interest overlap with board audience tags
targetReach = dailyImpressions × demoMatch
valueScore  = (weight × dailyImpressions
              + (1 - weight) × targetReach × 3)
              / weeklyCostUsd
```

`weight = 1` means pure awareness; `weight = 0` means pure audience targeting.

### Creative Director

The Creative Director receives the campaign, selected board, audience profile, brand-consistency preference, and generation number. It produces exactly two concepts with language, headline, subline, image prompt, and rationale. Fireworks generates wide artwork; Bilads applies copy separately so language and text remain exact.

When `spanishFriendly` is true, the pair contains one English and one Spanish concept. Otherwise it contains two distinct English concepts. A consistent-brand preference keeps tone and visual direction aligned across boards.

### Review room

The five-agent room is generated locally and deterministically. It provides structured critique and records messages and decisions without becoming an additional inference dependency.

## 6. Architecture and sponsor tools

| Layer | Technology | Requirement |
| --- | --- | --- |
| Application | Next.js 16, React 19, TypeScript | Server-rendered UI and Node.js API routes |
| Production persistence | MongoDB Atlas | System of record for campaigns, agent runs, messages, creative metadata, approvals, and workflow records |
| Binary assets | MongoDB GridFS | Product images, generated artwork, and cached audio |
| Development fallback | Local JSON and disk storage | Used only when `MONGODB_URI` is unset |
| Production inference | Fireworks | Text, vision, image generation, and optional embeddings and reranking |
| Approval orchestration | LangGraph | Resumable interrupt for human creative approval; MongoDB-backed checkpoints when Atlas is configured |
| Audio | ElevenLabs | Text-to-speech for approved campaign briefings; machine callers may synthesize a bounded raw transcript |
| Evaluation | OpenRouter | Explicit challenger-model calls through the machine-only Model Lab; never a production fallback |
| Maps and simulation | MapLibre, Leaflet, Recharts, Google Street View | Placement exploration, traffic context, street mockups, and performance scenarios |
| Development workflow | Cursor | Coding tooling only; no runtime dependency |

Fireworks is the only production inference provider. OpenRouter is intentionally separated behind `POST /api/model-lab`, requires the machine bearer credential, disables provider fallbacks and data collection, and must never be called automatically by research, generation, or approval flows.

Semantic retrieval is optional and off by default. When enabled, Fireworks creates embeddings and reranks candidates while MongoDB Atlas stores and searches the vectors. Keyword retrieval remains available until semantic relevance and latency have been validated.

## 7. Persistence and workspace model

Bilads has one seeded shared workspace with a fixed internal ID. It does not authenticate end users or accept workspace identifiers from browser input.

With `MONGODB_URI` configured:

- MongoDB Atlas is authoritative.
- GridFS stores binary objects and returns stable application file URLs.
- campaign, run, creative, decision, and asset writes are awaited and errors are surfaced;
- unique indexes and request IDs preserve idempotency;
- workflow state is stored in `platform_workflow_checkpoints`;
- LangGraph checkpoints use `langgraph_checkpoints` and `langgraph_checkpoint_writes`;
- startup or request failures must not fall back to local persistence.

Without `MONGODB_URI`, local development uses `app/.data` and `app/public/storage`. This fallback is for local compatibility, not production durability. The health endpoint `GET /api/health/mongodb` reports credential-safe connection status.

Asset keys are server-derived and scoped to workspace and campaign. Product assets use a private application route; generated creative and audio are served through controlled application file routes. Every stored asset retains its bucket, object key, URL, MIME type, byte size, and SHA-256 digest.

## 8. Human approval and audio

Creative approval exposes four routes under `/api/workflows/creative-approval`: `start`, `status`, `approve`, and `reject`.

- Starting a workflow derives or accepts a bounded thread ID and records the creative at `awaiting_approval`.
- LangGraph interrupts execution at the human decision boundary.
- Approve and reject calls are idempotent by request ID and protected against conflicting replay.
- A persisted decision resumes the same LangGraph thread.
- An approved creative may be added to semantic memory when that feature is enabled.
- Audio briefing generation verifies both the campaign and approved workflow state before calling ElevenLabs.
- Generated MP3 output is content-addressed and cached. If synthesis is unavailable, the route returns the transcript and an explicit fallback response.

## 9. API request gates

Bilads has two request principals:

- `shared-web`: a label for same-origin browser traffic, not authenticated identity;
- `machine`: a verified `Authorization: Bearer <BILADS_API_KEY>` caller.

Mutating browser requests require exact `BILADS_APP_ORIGIN` matching and JSON content type. These checks shape browser requests and reduce cross-site request risk; they are not account authentication. Anyone who can reach a public deployment may still call shared browser APIs, so deployment access controls, rate limits, and spend controls are operational requirements for a public instance.

The Model Lab is machine-only. A supplied invalid bearer credential must return `401` and must never fall back to shared-browser handling. Server credentials must not be exposed through public environment variables.

## 10. Shared contracts

`types.ts` at the repository root is the canonical source for data shared between routes, data files, and UI code. `app/scripts/sync-data.mjs` copies it and the canonical data files into `app/lib` before development and production builds.

Important request contracts:

- Campaign creation includes a UUID `clientRequestId`, brief, campaign parameters, and optional sample ID.
- Research includes `campaignId`, `requestId`, the matching saved brief, and campaign parameters.
- Generation includes `campaignId`, `requestId`, `billboardId`, brief, audience profile, `consistentBrand`, and optional non-negative `variant`.
- Approval operations include `campaignId`, workflow thread ID, and an idempotent request ID.
- Audio accepts either an approved structured briefing or, for machine callers only, a bounded raw transcript.

Shared enums remain string unions, boundary fields remain explicitly typed, and API changes must update the canonical type and this document together.

## 11. Data and simulation

Canonical data lives in `data/`. The curated buyer inventory contains 14 San Francisco placements grounded in planning permit locations. The seller cockpit uses the larger committed permit dataset. Pricing, impressions, audience fit, and campaign outcomes are modeled planning estimates; provenance and limitations are documented in `data/README.md` and `data/billboards.provenance.json`.

The simulation is client-side. For each day it models impressions with bounded variation, derives reach and target reach, applies an assumed conversion rate, and calculates total spend, blended CPM, estimated conversions, and CPA. The UI must show assumptions and must not present modeled outcomes as guarantees.

## 12. Environment

Copy `.env.example` to `app/.env.local`. Secrets are server-only and must not be committed.

| Purpose | Variables |
| --- | --- |
| Fireworks | `FIREWORKS_API_KEY`, `FIREWORKS_CHAT_MODEL`, `FIREWORKS_VISION_MODEL`, `FIREWORKS_IMAGE_MODEL`, `FIREWORKS_EMBEDDING_MODEL`, `FIREWORKS_RERANK_MODEL`, `FIREWORKS_EMBEDDING_DIMENSIONS` |
| Semantic retrieval | `SEMANTIC_RETRIEVAL_ENABLED` |
| MongoDB Atlas | `MONGODB_URI`, `MONGODB_DB`, `MONGODB_VECTOR_INDEX` |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_OUTPUT_FORMAT` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_EVAL_MODEL`, `OPENROUTER_PROVIDER_ORDER` |
| Browser and machine gates | `BILADS_APP_ORIGIN`, `BILADS_API_KEY` |
| Street scenes | `GOOGLE_MAPS_API_KEY` or `GOOGLE_STREET_VIEW_API_KEY` |

Model IDs have code defaults where documented in `.env.example`. Live Fireworks inference requires `FIREWORKS_API_KEY`; production durability requires `MONGODB_URI`. ElevenLabs, OpenRouter, semantic retrieval, and Street View are opt-in.

## 13. Acceptance criteria

- A sample or custom brief creates a durable campaign and can be reopened from `/campaigns`.
- Research returns a valid audience block, every ranked board, and no more than three in-budget recommendations.
- Ranking order is reproducible for the same data and inputs.
- Creative generation returns exactly two concepts, persists the generation, and supports regeneration.
- Product and generated assets retain complete storage metadata.
- Approval pauses and resumes the same workflow and rejects conflicting replay.
- Audio briefing synthesis is unavailable until the referenced creative is approved.
- The Model Lab accepts only a valid machine bearer and is not reachable as an automatic provider fallback.
- The app works locally without Atlas or optional provider credentials through documented fallbacks.
- With Atlas configured, persistence errors are surfaced and never silently redirected to local storage.
- Data validation, lint, typecheck, and production build complete, or any pre-existing gap is explicitly documented.

## 14. Verification

Run from the repository root:

```bash
node scripts/validate-data.mjs
node scripts/check-demomatch.mjs
cd app
npm run sync
npm run typecheck
npm run lint
npm run build
```

For a configured Atlas instance, also call `GET /api/health/mongodb` and exercise campaign creation, research, generation, approval start/decision/status, approved briefing audio, and the bearer-protected Model Lab.
