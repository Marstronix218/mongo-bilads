# Bilads

**Billboards, decided.**

Bilads is an AI-assisted billboard planning workspace for San Francisco. Give it a product brief, website, or image and it ranks affordable placements, generates neighborhood-aware creative concepts, places the creative into real street scenes, and simulates campaign reach and cost.

The project is a Next.js application with a local file-backed system of record. GMI Cloud powers language and image generation, Nimble enriches location research, BAND hosts the multi-agent review room, and a machine-facing Kylon endpoint can drive the workflow. Deterministic scoring and local fallbacks keep the core demo usable when optional integrations are unavailable.

## What it includes

- Product onboarding from a website, an uploaded image, or three built-in samples
- Deterministic billboard ranking by budget, impressions, and audience fit
- A map-first planning flow with location dossiers and traffic context
- English and Spanish neighborhood-aware creative variants
- Generated billboard mockups and campaign performance simulations
- A five-agent BAND review room with explicit human approval
- Saved campaigns, agent runs, decisions, and creative assets in a local store
- A seller cockpit at `/map` for inventory and advertiser prospecting

## Architecture

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Web application | Next.js 16, React 19, TypeScript | Onboarding, campaign workflow, maps, creative review, and API routes |
| System of record | Local JSON store and disk storage (`app/.data`, `app/public/storage`) | Campaigns, agent runs, messages, approvals, and durable assets |
| AI generation | GMI Cloud | Audience research, planning copy, and billboard artwork |
| Market intelligence | Nimble plus committed signal data | Location and audience enrichment |
| Agent collaboration | BAND | Five-agent discussion and approval workflow |
| Maps and simulation | MapLibre, Leaflet, Recharts, Google Street View | Placement exploration, mockups, and performance scenarios |

The application currently uses one seeded `bilads` workspace persisted on local disk. It does not provide end-user accounts or tenant isolation.

## Prerequisites

- Node.js 20.9 or newer and npm
- A GMI Cloud API key for live research and image generation
- Optional BAND, Nimble, and Google Maps/Street View credentials

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

   At minimum, configure `GMI_API_KEY` for live research and image generation. The default GMI endpoints and model IDs are already listed in `.env.example`.

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
| GMI Cloud | `GMI_API_KEY`, `GMI_BASE_URL`, `GMI_CHAT_MODEL`, `GMI_VISION_MODEL`, `GMI_IMAGE_MODEL`, `GMI_MEDIA_URL` | API key required for live AI; endpoints/models have defaults |
| Browser/API gates | `BILADS_APP_ORIGIN`, `BILADS_API_KEY` | App origin required in production; bearer key required for Kylon |
| BAND | `BAND_API_BASE_URL` and the five `BAND_*_API_KEY` values | Optional; local review-room fallback is available |
| Nimble | `NIMBLE_API_KEY` | Optional; committed signals are used as fallback |
| Street View | `GOOGLE_MAPS_API_KEY` or `GOOGLE_STREET_VIEW_API_KEY` | Optional |

`BILADS_APP_ORIGIN` shapes same-origin browser requests but is not user authentication; restrict access at the deployment layer if the shared workspace should not be public.

## Common commands

Run application commands from `app/`:

```bash
npm run dev       # development server; syncs canonical data first
npm run build     # production build; syncs canonical data first
npm run start     # serve a completed production build
npm run lint      # ESLint
npm run sync      # copy canonical root data into app/lib
npm run nimble:enrich
```

Run data checks from the repository root:

```bash
node scripts/validate-data.mjs
node scripts/check-demomatch.mjs
```

The canonical billboard inventory, provenance, traffic heatmap, and Nimble signals live in `data/`. The `predev` and `prebuild` hooks keep the copies consumed by Next.js in sync.

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

Live integrations intentionally fall back where possible; campaigns persist to the local store with no external services required. Generated performance figures are planning scenarios, not guaranteed outcomes.
