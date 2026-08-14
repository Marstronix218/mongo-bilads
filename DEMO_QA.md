# Bilads — Demo Q&A Cheat Sheet

This is the concise, accurate sponsor-integration story for demos and judging.

## One-line architecture

MongoDB Atlas records the campaign and durable assets, Fireworks performs the
production AI work, LangGraph pauses the selected creative for human approval,
ElevenLabs can narrate the approved briefing, and OpenRouter provides a separate
machine-only evaluation lab. Cursor supports development; VoyageAI is not
implemented.

| Sponsor | Demo answer | Evidence |
| --- | --- | --- |
| MongoDB Atlas / GridFS | Production system of record, files, checkpoints, and optional vectors | `app/lib/persistence.ts`, `app/lib/platform/mongo/` |
| Fireworks | Primary language, vision, image, embedding, and reranking provider | `app/lib/platform/providers/fireworks.ts` |
| LangChain / LangGraph | Durable human approval interrupt and resume flow | `app/lib/platform/workflows/langgraph.ts` |
| ElevenLabs | Cached MP3 briefing after approval | `app/app/api/audio/route.ts` |
| OpenRouter | Explicit machine-only challenger evaluations | `app/app/api/model-lab/route.ts` |
| Cursor | Development tooling only | No runtime integration |
| VoyageAI | Not implemented | No client, route, or environment variable |

## MongoDB Atlas / GridFS

### 30-second answer

> MongoDB Atlas is our production system of record. It holds campaigns, agent
> runs, creatives, messages, approvals, and workflow state. GridFS stores product
> assets, generated creatives, and cached audio, while MongoDBSaver persists the
> LangGraph checkpoint that lets a human approval pause survive a restart.

**Q: What happens without MongoDB?**

Local development uses `app/.data` for application state and files, plus an
in-memory LangGraph checkpointer. Once `MONGODB_URI` is configured, failures do
not silently divert writes to local storage; the request fails to prevent split
production state.

**Q: How do you prove Atlas is connected?**

Call `GET /api/health/mongodb`. It performs a server-side ping and reports only
connection status, never credentials.

**Q: What does GridFS add?**

It lets assets follow the same persistence boundary as campaign data. Bilads
stores product uploads, generated creatives, and campaign audio in named GridFS
buckets and retains both file metadata and stable identifiers.

**Q: Are vectors always enabled?**

No. `SEMANTIC_RETRIEVAL_ENABLED=false` is the default. Keyword retrieval remains
the deterministic baseline; Fireworks embeddings, reranking, and the Atlas vector
index are opt-in until their relevance and latency evaluation passes.

## Fireworks

### 30-second answer

> Fireworks is our primary production inference layer. It handles campaign
> research and planning, structured responses, billboard vision analysis, wide
> creative artwork, and the optional embedding and reranking path. The integration
> is direct and server-only, with explicit timeouts and bounded retries.

**Q: Which capabilities are live?**

With `FIREWORKS_API_KEY` configured, text, structured output, vision, and image
generation call Fireworks. Embeddings and reranking additionally require
`SEMANTIC_RETRIEVAL_ENABLED=true` in the retrieval path.

**Q: What happens if Fireworks is unavailable?**

Where the product permits it, the campaign flow returns deterministic research
or scoring and placeholder creative output. Calls are time-bounded so a provider
failure does not hang the request. The fallback is labeled rather than presented
as live inference.

**Q: How is billboard artwork produced?**

The image provider requests a 1536×768 render. Application code remains
responsible for exact layout and text overlays so model-generated artwork is not
treated as authoritative campaign copy.

**Q: Does another provider silently take over?**

No. Fireworks is the production inference provider. The Model Lab is an explicit,
isolated evaluation path and never becomes an automatic runtime fallback.

## LangChain / LangGraph

### 30-second answer

> LangGraph implements the approval gate as a real resumable workflow. Starting
> a review pauses on an interrupt with the campaign and creative. A human approve
> or reject action resumes that exact thread, and the decision is also recorded as
> business state for an auditable campaign history.

**Q: Is approval just a UI button?**

No. The server starts a LangGraph thread, pauses it at `interrupt`, and resumes it
with a `Command` containing the decision, request ID, note, and deciding subject.
The workflow API detects missing and conflicting decisions.

**Q: Is it durable?**

With Atlas configured, `MongoDBSaver` writes checkpoints to
`langgraph_checkpoints` and `langgraph_checkpoint_writes`. Local development uses
`MemorySaver`, which is intentionally non-durable.

**Q: Which endpoints drive it?**

- `POST /api/workflows/creative-approval/start`
- `GET /api/workflows/creative-approval/status`
- `POST /api/workflows/creative-approval/approve`
- `POST /api/workflows/creative-approval/reject`

## ElevenLabs

### 30-second answer

> ElevenLabs turns the approved campaign briefing into an MP3. The endpoint
> verifies the campaign and approval state before generating browser-requested
> audio, then caches the result by transcript, voice, and model so repeat requests
> do not synthesize the same briefing again.

**Q: Can audio be generated before approval?**

Not through the browser briefing flow. `POST /api/audio` checks that the workflow
status is `approved`. Raw transcript synthesis is reserved for machine callers
authenticated with `BILADS_API_KEY`.

**Q: Where is the audio stored?**

The `campaign-audio` bucket uses GridFS when Atlas is configured and local file
storage in local development.

**Q: What if ElevenLabs is not configured?**

The endpoint returns the validated transcript, `audio: null`, and
`fallback: true` with a reason. It does not fabricate or mislabel an audio result.

## OpenRouter Model Lab

### 30-second answer

> OpenRouter powers a deliberately isolated Model Lab for challenger-model
> evaluation. It is a machine-only endpoint, requires an explicit model, disables
> provider fallback and data collection, and cannot silently replace our
> production inference path.

**Q: Who can call it?**

`POST /api/model-lab` rejects browser access and requires
`Authorization: Bearer <BILADS_API_KEY>`.

**Q: Why isolate it?**

Evaluation and production are different governance domains. Isolation makes an
experiment intentional, preserves provider provenance, and prevents a benchmark
or challenger model from changing campaign behavior without an explicit request.

**Q: What privacy controls are requested?**

The provider request disables automatic fallback, denies data collection,
requires parameter support, and requests zero-data-retention routing.

## Cursor

**Q: Where does Cursor run in the product?**

It does not. Cursor supports development, navigation, refactoring, and review.
There is no deployed runtime dependency, API key, or application endpoint for it.

## VoyageAI

**Q: Is VoyageAI integrated?**

No. The current repository has no VoyageAI client, environment variable, route,
or fallback. Optional semantic retrieval currently uses Fireworks embeddings and
reranking with MongoDB Atlas.

## Cross-cutting questions

**Q: What is the end-to-end flow?**

A user creates a campaign; Fireworks produces research, planning, analysis, and
creative output; MongoDB records runs and assets; LangGraph pauses the selected
creative for explicit approval; and, after approval, ElevenLabs can generate a
cached audio briefing. OpenRouter remains available only for separate challenger
evaluation.

**Q: Which integrations are required?**

For live production behavior, configure `FIREWORKS_API_KEY` and `MONGODB_URI`.
ElevenLabs, OpenRouter, Street View, and semantic retrieval are opt-in. Cursor is
development tooling. VoyageAI is not part of the application.

**Q: How are secrets handled?**

All provider keys and `MONGODB_URI` are server-only and belong in
`app/.env.local`. They must never use a `NEXT_PUBLIC_*` name. Machine-only routes
use `BILADS_API_KEY`; `BILADS_APP_ORIGIN` shapes same-origin browser requests but
is not user authentication.

**Q: What is real versus fallback during a demo?**

| Integration | Live behavior | Honest fallback |
| --- | --- | --- |
| MongoDB Atlas / GridFS | Durable data and file persistence | Local development state and files when no URI is configured |
| Fireworks | Live text, vision, image, and optional retrieval inference | Deterministic or placeholder behavior where supported |
| LangGraph | Durable Atlas-backed checkpoints | In-memory checkpoints for local development |
| ElevenLabs | Approved MP3 briefing | Validated transcript with explicit fallback metadata |
| OpenRouter | Explicit challenger evaluation | Configuration/provider error; never production substitution |

**Q: Are reach, conversion, and performance figures predictions?**

No. They are planning scenarios based on exposed assumptions, not guaranteed
outcomes.

## Demo setup checklist

- Copy `.env.example` to `app/.env.local`.
- Set `FIREWORKS_API_KEY` for live inference.
- Set `MONGODB_URI` for production persistence and durable checkpoints.
- Optionally set ElevenLabs and OpenRouter variables for those demo paths.
- Set `BILADS_API_KEY` before demonstrating the machine-only Model Lab or raw
  transcript synthesis.
- Verify Atlas with `GET /api/health/mongodb`.
- Keep `SEMANTIC_RETRIEVAL_ENABLED=false` unless the vector relevance gate has
  been intentionally enabled and verified.
