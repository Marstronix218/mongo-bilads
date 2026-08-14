# Bilads maintenance handoff

Updated: 2026-08-13

## Current system

Bilads is a Next.js 16 application for AI-assisted San Francisco billboard planning. The supported architecture is:

- MongoDB Atlas as the production system of record;
- GridFS for product images, generated creative, and cached audio;
- local JSON and disk storage only when `MONGODB_URI` is unset;
- Fireworks for production text, vision, image, embedding, and reranking inference;
- LangGraph for resumable human creative approval, with MongoDB-backed checkpoints in production;
- ElevenLabs for approved campaign briefing audio;
- OpenRouter only for explicit machine-authenticated Model Lab evaluations.

There are no user accounts or tenant model. The application operates as one shared workspace. Browser request checks are request shaping, not authentication.

## Start here

Read these files before changing a subsystem:

- `README.md` — setup, architecture, and operator overview
- `PRD.md` — product requirements and acceptance criteria
- `.env.example` — supported environment variables
- `types.ts` — canonical shared data and API contracts
- `app/lib/persistence.ts` — MongoDB/local persistence selection
- `app/lib/platform/mongo/` — Atlas repositories, contracts, and GridFS
- `app/lib/platform/providers/` — Fireworks, ElevenLabs, and OpenRouter adapters
- `app/lib/platform/workflows/` — approval state machine and LangGraph integration
- `app/lib/apiAuth.ts` — shared-browser and machine request gates

Canonical data belongs in `data/`. Run `npm run sync` from `app/` after changing root contracts or synced data; do not edit generated copies under `app/lib` as the source of truth.

## Invariants

1. Fireworks is the production inference path. OpenRouter must remain isolated to `/api/model-lab` and must never become a silent fallback.
2. A configured `MONGODB_URI` means Atlas is authoritative. Database failures must surface instead of switching to local persistence.
3. Local persistence exists only for development when `MONGODB_URI` is absent.
4. All provider and database credentials stay server-side. Do not add public secret variables.
5. The browser principal is not authenticated identity. Do not add account semantics without a new product decision.
6. A supplied bearer header is always evaluated as a machine credential. Invalid credentials return `401` and never fall back to browser handling.
7. Asset buckets and object keys are derived by the server. Persist URL, key, MIME type, byte size, and SHA-256 together.
8. Research and generation writes are idempotent by request ID and must be awaited.
9. Billboard ranking remains deterministic; models explain rankings but do not establish their order.
10. Creative must be approved through the resumable workflow before a structured briefing can be synthesized as audio.

## Primary routes

| Route | Purpose |
| --- | --- |
| `GET/POST /api/campaigns` | List or create campaigns and persist optional product assets |
| `POST /api/research` | Run and persist audience research plus deterministic board ranking |
| `POST /api/generate` | Generate, store, and version two creative concepts |
| `/api/workflows/creative-approval/{start,status,approve,reject}` | Start, inspect, and resolve the human approval interrupt |
| `POST /api/audio` | Synthesize and cache approved briefings; bounded raw transcript is machine-only |
| `POST /api/model-lab` | Run an explicit machine-only challenger evaluation |
| `GET /api/health/mongodb` | Return a credential-safe Atlas health result |
| `GET /api/platform/files/[bucket]/[id]` | Serve stored files through the application boundary |

## Persistence notes

The shared workspace ID and slug are owned by the persistence layer. Browser input must never select a workspace. MongoDB collections cover campaigns, agent runs, messages, creative variants and assets, approval decisions, workflow records, and optional retrieval memory. GridFS stores bytes while metadata remains queryable with the campaign.

Approval has two durable layers:

- `platform_workflow_checkpoints` stores the application state machine, revisions, decisions, and processed request IDs;
- the LangGraph checkpoint collections store the suspended and resumed graph execution.

The state machine uses compare-and-set revisions and idempotent request IDs. Preserve those protections when changing workflow routes.

## Provider boundaries

Fireworks calls go through the typed inference contracts and shared HTTP helper. Generated image bytes are returned to application storage; copy is rendered separately from artwork. Semantic retrieval is controlled by `SEMANTIC_RETRIEVAL_ENABLED` and should stay disabled until relevance and latency are measured.

ElevenLabs receives either a server-constructed approved campaign briefing or a bounded raw transcript from a verified machine caller. Audio is cached by a content hash of transcript and voice/model settings.

OpenRouter evaluations require `BILADS_API_KEY`, set provider data collection to denied, and disable provider fallbacks. Keep evaluation results out of automatic production decisions.

## Environment

Copy `.env.example` to `app/.env.local`. The main groups are:

- `MONGODB_*` for Atlas, GridFS metadata, checkpoints, and optional vector search;
- `FIREWORKS_*` for production inference;
- `ELEVENLABS_*` for approved audio;
- `OPENROUTER_*` for the Model Lab;
- `BILADS_APP_ORIGIN` and `BILADS_API_KEY` for browser shaping and machine authentication;
- Google Maps or Street View key for street-scene imagery.

Never print local secret values in logs, reviews, or handoff notes.

## Change checklist

- Update `types.ts` and `PRD.md` together when an API boundary changes.
- Keep canonical inventory and signal changes under `data/`, then run the sync script.
- Preserve deterministic fallbacks for research, ranking, creative copy, and demo assets.
- Keep production persistence fail-closed.
- Add or update targeted tests when changing idempotency, workflow decisions, request gates, or provider error handling.
- Check the final diff for accidental secret values and stale generated artifacts.

## Verification

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

When credentials are available, also smoke-test Atlas health, campaign creation, research, generation, approval start/status/decision, approved audio, and the machine-only Model Lab. Report any provider smoke test that could not run rather than implying it passed.

## Known operational risks

- The shared browser workspace is reachable by anyone who can access a public deployment. Exact-origin checks do not replace deployment access control, rate limiting, or spend/concurrency limits.
- Semantic retrieval is feature-gated because ranking quality must remain deterministic and measurable.
- Campaign performance figures are planning estimates, not guaranteed outcomes.
- There is no complete automated unit-test suite; typecheck, data validation, targeted route tests, and production build remain the minimum release evidence.
