# Bilads

**Billboards, decided.**

Bilads is an AI-assisted billboard planning workspace for San Francisco. Give it a product brief, website, or image and it ranks affordable placements, generates neighborhood-aware creative concepts, places the creative into real street scenes, and simulates campaign reach and cost.

The project is a Next.js application with MongoDB Atlas as its production system of record and a local development fallback. Fireworks powers language, vision, image generation, and the optional semantic-memory layer; LangGraph provides resumable human approval; ElevenLabs turns approved campaign briefs into audio; and OpenRouter is isolated to a machine-only model evaluation lab. Deterministic scoring and local fallbacks keep the core demo usable when optional live integrations are unavailable.

## Demo video

[Watch the Bilads demo on YouTube](https://youtu.be/jXLWPkNEQKk)

## What it includes

- Product onboarding from a website, an uploaded image, or three built-in samples
- Deterministic billboard ranking by budget, impressions, and audience fit
- A map-first planning flow with location dossiers and traffic context
- English and Spanish neighborhood-aware creative variants
- Generated billboard mockups and campaign performance simulations
- A five-agent review room with explicit human approval
- Saved campaigns, agent runs, decisions, and versioned creative assets in MongoDB and GridFS
- Resumable creative approval workflows and approved-briefing audio
- A separately governed OpenRouter Model Lab for explicit challenger evaluations
- A seller cockpit at `/map` for inventory and advertiser prospecting

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web application | Next.js 16, React 19, TypeScript | Onboarding, campaign workflow, maps, creative review, and API routes |
| System of record | MongoDB Atlas and GridFS | Campaigns, agent runs, messages, approvals, checkpoints, and durable assets |
| Local compatibility | JSON and disk storage (`app/.data`, `app/public/storage`) | Development fallback only when `MONGODB_URI` is unset |
| Production inference | Fireworks | Audience research, planning copy, vision analysis, artwork, embeddings, and reranking |
| Resumable workflow | LangGraph with MongoDBSaver | Creative approval interrupt, durable checkpoint, and explicit resume |
| Approved audio | ElevenLabs | Cached text-to-speech briefings after approval |
| Model evaluation | OpenRouter | Explicit, machine-only challenger runs; never a silent production fallback |
| Market intelligence | Committed location-signal data | Location and audience enrichment |
| Agent collaboration | Local deterministic agent room | Five-agent discussion and approval workflow |
| Maps and simulation | MapLibre, Leaflet, Recharts, Google Street View | Placement exploration, mockups, and performance scenarios |

The application currently uses one seeded `bilads` workspace persisted on local disk. It does not provide end-user accounts or tenant isolation.

## Prerequisites

- Node.js 20.9 or newer and npm
- A Fireworks API key for live research, vision, and image generation
- MongoDB Atlas for production persistence; local development works without it
- Optional ElevenLabs, OpenRouter, and Google Maps/Street View credentials

## Local setup

1. Install the application dependencies:

   ```bash
   cd app
   npm ci
   cd ..
   ```

2. Create the local environment file and fill in the required values:

   ```bash
   cp .env.example app/.env.local
   ```

   Configure `FIREWORKS_API_KEY` for live generation. Configure `MONGODB_URI` for production persistence. The remaining integrations are opt-in and documented in `.env.example`.

3. Start the development server:

   ```bash
   cd app
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). The main routes are `/`, `/campaigns`, and `/map`; `/results` is entered through the campaign form.

## Environment variables

The commented template in `.env.example` is the source of truth. Keep all secrets in `app/.env.local`; it is ignored by Git.

| Group | Variables | Required? |
| --- | --- | --- |
| MongoDB Atlas | `MONGODB_URI`, `MONGODB_DB`, `MONGODB_VECTOR_INDEX` | URI required in production; database defaults to `bilads` |
| Fireworks | `FIREWORKS_API_KEY`, `FIREWORKS_*_MODEL`, `FIREWORKS_EMBEDDING_DIMENSIONS` | API key required for live AI; model IDs have defaults |
| Semantic retrieval | `SEMANTIC_RETRIEVAL_ENABLED` | Off by default until a relevance evaluation passes |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | Optional; approved briefing audio |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_EVAL_MODEL`, `OPENROUTER_PROVIDER_ORDER` | Optional; machine-only Model Lab |
| Browser/API gates | `BILADS_APP_ORIGIN`, `BILADS_API_KEY` | App origin required in production; bearer key required for machine callers |
| Street View | `GOOGLE_MAPS_API_KEY` or `GOOGLE_STREET_VIEW_API_KEY` | Optional |

All provider keys and `MONGODB_URI` are server-only credentials and must never be exposed through a `NEXT_PUBLIC_*` variable. `BILADS_APP_ORIGIN` shapes same-origin browser requests but is not user authentication; restrict access at the deployment layer if the shared workspace should not be public. With the app running, `GET /api/health/mongodb` performs a credential-safe Atlas ping and returns only connection status.

## Common commands

Run application commands from `app/`:

```bash
npm run dev       # development server; syncs canonical data first
npm run build     # production build; syncs canonical data first
npm run start     # serve a completed production build
npm run lint      # ESLint
npm run sync      # copy canonical root data into app/lib
```

Run data checks from the repository root:

```bash
node scripts/validate-data.mjs
node scripts/check-demomatch.mjs
```

The canonical billboard inventory, provenance, traffic heatmap, and location signals live in `data/`. The `predev` and `prebuild` hooks keep the copies consumed by Next.js in sync.

## Data provenance and limitations

The buyer workflow uses 14 curated SF placements grounded in real Planning Department permit locations. The seller cockpit draws from 559 permit records. Pricing, impressions, demographic fit, and performance outputs are modeled planning estimates; `data/billboards.provenance.json` records the source permit and rate-card grounding for each curated placement. See `data/README.md` for the complete methodology and known photo-annotation limitations.

## Repository layout

```text
app/          Next.js application and API routes
data/         Canonical billboard inventory, signals, caches, and map data
scripts/      Data generation, validation, enrichment, and cache utilities
types.ts      Canonical shared data contracts
PRD.md        Product requirements and demo narrative
DEMO_QA.md    Integration and demo Q&A reference
```

## Verification

Before opening a pull request or deploying, run:

```bash
node scripts/validate-data.mjs
cd app
npm run lint
npm run build
```

There is no automated unit-test suite yet. The production build and data validation currently pass. The full lint command also scans existing generated `.vercel/output` files and reports pre-existing React effect violations in the results UI; address or exclude those before treating lint as a clean quality gate.

Live inference falls back where product behavior permits. Production persistence fails closed when `MONGODB_URI` is configured, preventing silent divergence into local data. Generated performance figures are planning scenarios, not guaranteed outcomes.
