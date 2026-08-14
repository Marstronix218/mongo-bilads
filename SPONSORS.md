# Sponsor Integration Guide

Bilads uses the following sponsor tools:

- **MongoDB Atlas** and **GridFS**
- **Fireworks**
- **LangChain / LangGraph**
- **ElevenLabs**
- **OpenRouter**
- **Cursor**
- **VoyageAI** is not currently implemented

## Architecture at a glance

| Sponsor | Status | Role in Bilads | Primary implementation |
| --- | --- | --- | --- |
| MongoDB Atlas / GridFS | Integrated | Production system of record, durable files, approval checkpoints, and optional vector search | `app/lib/mongodb.ts`, `app/lib/persistence.ts`, `app/lib/platform/mongo/` |
| Fireworks | Integrated | Production text, structured output, vision, image generation, embeddings, and reranking | `app/lib/platform/providers/fireworks.ts`, `app/lib/inference.ts` |
| LangChain / LangGraph | Integrated | Resumable creative approval with a human decision interrupt | `app/lib/platform/workflows/langgraph.ts`, `app/lib/platform/workflows/creativeApproval.ts` |
| ElevenLabs | Integrated, optional | MP3 briefing generation after a creative has been approved | `app/lib/platform/providers/elevenlabs.ts`, `app/app/api/audio/route.ts` |
| OpenRouter | Integrated, optional and isolated | Explicit challenger-model evaluations through a machine-only Model Lab | `app/lib/platform/providers/openrouter.ts`, `app/app/api/model-lab/route.ts` |
| Cursor | Tooling | Development and code-authoring workflow; no runtime dependency | Repository development environment |
| VoyageAI | Not implemented | No production or fallback path currently calls VoyageAI | None |

## MongoDB Atlas and GridFS

MongoDB is the production persistence layer. It stores campaigns, agent runs,
creative variants, messages, approvals, workflow business state, and related
metadata. GridFS stores product assets, generated creatives, and campaign audio.
LangGraph uses `MongoDBSaver` for durable pause/resume checkpoints, and the
semantic retrieval layer can use an Atlas vector index when enabled.

When `MONGODB_URI` is blank, local development uses `app/.data` and an in-memory
LangGraph checkpointer. When `MONGODB_URI` is configured, persistence does not
silently fall back if Atlas becomes unavailable; requests fail so production
state cannot diverge.

Configuration:

- `MONGODB_URI`
- `MONGODB_DB` (defaults to `bilads`)
- `MONGODB_VECTOR_INDEX`

Health check: `GET /api/health/mongodb` performs a credential-safe ping and
returns connection status without exposing the URI.

## Fireworks

Fireworks is the primary production inference provider. Bilads calls it for:

- audience research and campaign planning text;
- structured model output;
- billboard and creative vision analysis;
- 1536×768 artwork generation;
- optional embeddings and reranking for semantic creative memory.

Provider calls have bounded timeouts and retry policies. Core demo paths use
deterministic or placeholder fallbacks where the product permits them. Semantic
retrieval is disabled by default and keyword retrieval remains available until
the semantic relevance and latency gate is enabled.

Configuration:

- `FIREWORKS_API_KEY`
- `FIREWORKS_CHAT_MODEL`
- `FIREWORKS_VISION_MODEL`
- `FIREWORKS_IMAGE_MODEL`
- `FIREWORKS_EMBEDDING_MODEL`
- `FIREWORKS_RERANK_MODEL`
- `FIREWORKS_EMBEDDING_DIMENSIONS`
- `SEMANTIC_RETRIEVAL_ENABLED`

## LangChain and LangGraph

LangGraph supplies the resumable human approval gate. Starting the workflow
records the selected creative and pauses at an `interrupt`. Approving or
rejecting resumes the same thread with the human decision. Business state and
the checkpoint are stored separately so the approval record remains auditable.

Workflow endpoints:

- `POST /api/workflows/creative-approval/start`
- `GET /api/workflows/creative-approval/status`
- `POST /api/workflows/creative-approval/approve`
- `POST /api/workflows/creative-approval/reject`

With Atlas configured, checkpoints live in `langgraph_checkpoints` and
`langgraph_checkpoint_writes`. Local development uses `MemorySaver`.

## ElevenLabs

ElevenLabs converts an approved campaign briefing into MP3 audio through
`POST /api/audio`. A browser briefing request is validated against the stored
campaign and approval workflow before synthesis. Raw transcript synthesis is
restricted to callers authenticated with `BILADS_API_KEY`.

Generated audio is content-addressed and cached in the `campaign-audio` file
bucket. With Atlas configured that bucket is backed by GridFS; local development
uses local file storage. If synthesis is unavailable, the endpoint returns the
transcript and an explicit fallback response rather than fabricated audio.

Configuration:

- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ELEVENLABS_MODEL_ID`
- `ELEVENLABS_OUTPUT_FORMAT`

## OpenRouter

OpenRouter is deliberately separated from production inference. The machine-only
`POST /api/model-lab` endpoint runs explicit challenger-model evaluations and
requires `Authorization: Bearer <BILADS_API_KEY>`.

It is never selected as an automatic fallback. The request disables provider
fallbacks and data collection, requires requested parameters, and enables
zero-data-retention routing. A model must be supplied in the request or through
`OPENROUTER_EVAL_MODEL`.

Configuration:

- `OPENROUTER_API_KEY`
- `OPENROUTER_EVAL_MODEL`
- `OPENROUTER_PROVIDER_ORDER`
- `BILADS_API_KEY`

## Cursor

Cursor supports repository development, navigation, refactoring, and review.
It does not run in the deployed application and requires no runtime environment
variables or API route.

## VoyageAI

VoyageAI is not implemented in the current application. There is no VoyageAI
client, environment variable, API route, or fallback behavior. Optional semantic
retrieval currently uses Fireworks embeddings and reranking with MongoDB Atlas.

## Honest live and fallback status

| Capability | Live path | Behavior when not configured |
| --- | --- | --- |
| Persistence and files | MongoDB Atlas and GridFS | Local development storage in `app/.data` |
| Approval checkpoints | LangGraph `MongoDBSaver` | LangGraph `MemorySaver` for local development |
| Production inference | Fireworks | Deterministic research/scoring or placeholder creative behavior where supported |
| Semantic retrieval | Fireworks plus Atlas vector search when explicitly enabled | Deterministic keyword retrieval |
| Approved audio | ElevenLabs | Transcript plus explicit `fallback: true`; no fabricated audio |
| Challenger evaluation | OpenRouter Model Lab | Endpoint reports a configuration/provider error; never replaces Fireworks |

All provider credentials and `MONGODB_URI` are server-only. Keep them in
`app/.env.local` and never expose them through `NEXT_PUBLIC_*` variables.
