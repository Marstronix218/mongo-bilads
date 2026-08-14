# Noriaki — Backend & Agent Architecture Lead

**Role:** API contracts, Fireworks inference, deterministic agent fallbacks, MongoDB persistence, LangGraph approval, approved audio, and governed model evaluation.

Noriaki owns the server-side campaign pipeline. Live inference enriches the experience, while deterministic ranking, committed location signals, caches, and local fallbacks keep core flows available when optional services are unavailable.

---

## Current Architecture

| Capability | Implementation |
|---|---|
| Production inference | Fireworks through `app/lib/platform/providers/fireworks.ts` |
| Stable inference facade | `app/lib/inference.ts` |
| Research and planning | `app/app/api/research/route.ts`, `app/lib/researcher.ts`, `app/lib/mediaBuyer.ts` |
| Creative generation | `app/app/api/generate/route.ts`, `app/lib/creative.ts` |
| Vision review | `app/app/api/attention/route.ts`, `app/lib/attention.ts` |
| Persistence | `app/lib/persistence.ts` with MongoDB Atlas/GridFS or local fallback |
| Human approval | `app/lib/platform/workflows/langgraph.ts` and `app/lib/platform/workflows/creativeApproval.ts` |
| Approval API | `app/app/api/workflows/creative-approval/*/route.ts` |
| Approved audio | `app/app/api/audio/route.ts` and the ElevenLabs provider |
| Model evaluation | Machine-only `app/app/api/model-lab/route.ts` through OpenRouter |
| Review room | Deterministic `app/lib/room.ts` exposed by `app/app/api/room/route.ts` |

---

## Core Pipeline

1. `/api/research` validates the brief and creates or updates campaign state.
2. The Researcher uses Fireworks when configured and receives committed signals from `data/signals/`.
3. The Media Buyer calculates rankings deterministically; generated prose only explains the math.
4. `/api/generate` creates constrained concepts and 2:1 artwork through Fireworks, with cache and deterministic creative fallbacks.
5. The local five-agent review room derives its discussion from real campaign, ranking, creative, and signal data.
6. The LangGraph workflow interrupts at creative approval and resumes only after an explicit approve or reject request.
7. MongoDB stores production campaign state and LangGraph checkpoints; GridFS stores durable binary assets.
8. ElevenLabs can synthesize and cache a briefing only after the API verifies that the creative is approved.
9. OpenRouter is restricted to authenticated machine evaluation in the Model Lab and is never an automatic production fallback.

---

## Backend Checklist

- [x] Keep request validation and response contracts aligned with `app/lib/types.ts`.
- [x] Keep the scoring algorithm deterministic and independent of model output.
- [x] Parse structured model responses defensively and fall back without dead-ending the user.
- [x] Route language, vision, artwork, embeddings, and reranking through the Fireworks provider boundary.
- [x] Inject committed location signals into research without making them a hard dependency.
- [x] Persist campaign, creative, agent-run, message, approval, and asset records through `app/lib/persistence.ts`.
- [x] Store binary assets through GridFS when MongoDB is configured.
- [x] Keep local JSON/disk storage available for development.
- [x] Require explicit human approval in the review room and LangGraph workflow.
- [x] Use durable MongoDB checkpoints in production and in-memory checkpoints locally.
- [x] Require approval verification before ElevenLabs briefing synthesis.
- [x] Cache synthesized MP3s under the campaign-audio storage bucket.
- [x] Keep the OpenRouter Model Lab machine-only, explicit, and isolated from production inference.

### Safety and Reliability Contracts

- Rankings come from code, not model judgment.
- Generated imagery must not invent logos, prices, claims, testimonials, or location facts.
- Billboard copy remains a controlled overlay rather than model-rendered text.
- A failed live inference call must fall through to a cached or deterministic response.
- Approval requests are idempotent and conflict-checked.
- Raw audio transcripts and Model Lab prompts require machine authentication.
- Provider credentials remain server-only and are loaded from environment variables.

---

## Verification Checklist

- Run `npm --prefix app run typecheck`.
- Run `npm --prefix app run lint`.
- Run `npm --prefix app run build` for release verification.
- Run `node scripts/validate-data.mjs` and `node scripts/validate-demo-cache.mjs`.
- Check `GET /api/health/mongodb` in an Atlas-configured environment.
- Exercise research, generation, review-room approval, LangGraph approve/reject, and approved-audio paths.
- Confirm the core campaign flow still returns valid results with optional provider credentials removed.
- Confirm `/api/model-lab` rejects browser access and works only with the configured machine credential.

---

## Q&A Ownership

Noriaki answers questions about the agent pipeline, deterministic ranking, Fireworks provider boundaries, fallback behavior, MongoDB Atlas and GridFS persistence, resumable LangGraph approvals, ElevenLabs approval gating, and the isolation of the OpenRouter Model Lab.
