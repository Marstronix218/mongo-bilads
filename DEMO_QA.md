# BilAds — Post-Demo Q&A Cheat Sheet (Sponsor Integrations)

Quick-reference for answering judge/sponsor questions after the demo.
Each sponsor section has: a **30-second answer**, **where it lives in the code**,
and **likely questions with prepared answers** (including the tough ones).

**Jump to:**
[One-liner map](#one-liner-map) ·
[Nimble](#1-nimble--live-market--location-intelligence) ·
[OpenAI](#2-openai--text-vision--image-generation) ·
[BAND](#3-band--agent-collaboration--human-approval) ·
[Kylon](#4-kylon--ai-workforce-management) ·
[InsForge](#5-insforge--backend--system-of-record) ·
[BAND vs Kylon](#band-vs-kylon-the-question-youll-definitely-get) ·
[Cross-cutting questions](#cross-cutting-questions) ·
[Honesty box](#honesty-box-live-vs-fallback)

---

## One-liner map

| Sponsor | Role in BilAds | Key files |
|---|---|---|
| **Nimble** | Live market & location intelligence feeding the Research Agent | `app/lib/nimble.ts`, `data/nimble-signals/` |
| **OpenAI** | All language reasoning, vision analysis, and ad image generation | `app/lib/openai.ts`, `app/lib/images.ts` |
| **BAND** | Five-agent debate room + mandatory human approval | `app/lib/band.ts`, `app/lib/band-client.ts` |
| **Kylon** | The persistent AI marketing workforce running the assignment pipeline | `app/app/api/kylon/route.ts` |
| **InsForge** | System of record: campaigns, agent runs/messages, approvals, asset storage | `app/lib/insforge.ts`, `migrations/` |

**The story in one sentence:** Kylon's AI employees run the campaign workflow, Nimble gives them fresh market intelligence, OpenAI does the reasoning, vision analysis, and creative rendering, BAND is where the agents debate and the human approves, and InsForge records everything durably.

---

## BAND vs Kylon — the question you'll definitely get

This is the single most likely "gotcha." Have the distinction ready before anyone asks.

### 10-second answer
> "Kylon is the **org chart** — who's on the AI team and what they're assigned. BAND is the **meeting room** — where those agents actually argue it out and the human signs off. Different layer, different job."

### The clean framing
- **Kylon manages the workforce.** It answers *"who is doing what, with what company context?"* — the persistent AI marketing employees, their assignments, and the brand guidelines / approved claims / budget rules they operate under.
- **BAND manages the decision.** It answers *"is this campaign actually good, and who approved it?"* — the moment the specialists challenge each other's conclusions and a human gives explicit sign-off.

### Side-by-side

| | **Kylon** | **BAND** |
|---|---|---|
| **Layer** | Workforce orchestration | Decision governance |
| **Answers** | Who is assigned what | Is this the right call, and who approved |
| **Unit of work** | An assignment (research, media plan, creative, budget…) | A message / debate / approval event in a shared room |
| **Time horizon** | Ongoing, persistent team | A single campaign's deliberation |
| **Human's role** | Sets context, hands out work | Reviews the debate, approves or rejects |
| **State** | Workspace + assignment pipeline | Room + messages + approval event |
| **Code** | `app/app/api/kylon/route.ts` | `app/lib/band.ts`, `app/lib/band-client.ts` |

### Why they're not redundant
They occupy adjacent-but-separate layers and are **explicitly wired together, not overlapping**: Kylon's fifth assignment is literally *"Request approval,"* and executing it **spins up a BAND room and stores that `roomId` in the assignment's handoff**. So the workforce layer *invokes* the decision layer — you can trace the link in data, not just in the pitch. Remove Kylon and you lose the persistent team and its context; remove BAND and you lose the multi-agent debate and the human approval gate. Neither replaces the other.

### Analogy (if a judge wants it plainer)
> "Kylon is the staffing and assignment system — like a project manager handing tasks to employees. BAND is the review meeting where those employees present, disagree, and the boss approves. You wouldn't merge your staffing tool with your approval workflow, and neither would we."

---

## 1. Nimble — Live market & location intelligence

### 30-second answer
> "Every billboard location has a Nimble intelligence file — nearby businesses, retail density, transit, events, competitors. We inject those signals directly into the Research Agent's prompt, so the market intelligence demonstrably changes the audience profile and location recommendations. Any finding derived from Nimble data is tagged and shown in the UI with a 'Source: Nimble' badge."

### Where it lives
- `app/lib/nimble.ts` — loads per-board signals, builds the prompt block, tags findings with `[Nimble]`.
- `app/lib/researcher.ts` — injects `nimblePromptBlock()` into the LLM prompt; fallback path still surfaces a Nimble finding.
- `data/nimble-signals/<boardId>.json` — one signal file per SF billboard (Embarcadero, Hayes Valley, Mission 24th, …).

### Likely questions

**Q: How does Nimble actually influence the recommendation — or is it decoration?**
It changes model inputs, not just UI. The signals are inserted into the Researcher's prompt with an explicit instruction to let them shape `audienceProfile.interests` and findings, and to prefix Nimble-derived findings. Different signals → different audience profile → different location scores.

**Q: Is this calling the Nimble API live during the demo?**
The demo runs on a pre-generated Nimble signal dataset (built from real nearby-business data) so the demo is fast and deterministic; `NIMBLE_API_KEY` switches on the live pipeline that refreshes those files. Signals are enrichment, never a hard dependency — a missing file can't break a campaign.

**Q: How do you know a finding came from Nimble?**
Findings carry a `[Nimble]` prefix at the API layer; the frontend strips it and renders a "Source: Nimble" badge, so provenance is visible to the user, not just in logs.

---

## 2. OpenAI — Text, vision, and image generation

### 30-second answer
> "OpenAI powers the full AI path: research, concept generation, and vision analysis use the Responses API, while billboard artwork uses the Image API. One native SDK covers every modality, and every call has a timeout and deterministic fallback so the app never dead-ends."

### Where it lives
- `app/lib/openai.ts` — server-only OpenAI client using the Responses and Image APIs.
- `app/lib/images.ts` — generates ad images, uploads them to InsForge Storage for durable URLs.
- Used by `/api/research`, `/api/generate`, and the vision-based billboard detection.

### Likely questions

**Q: Which models, and why?**
`gpt-5.6-luna` for text and vision because the workflow is high-volume and latency/cost-sensitive. `gpt-image-2` renders wide 1536×768 creatives. Both are configurable by environment variable.

**Q: What happens if OpenAI is slow or down?**
Responses calls are capped at 20s and image calls at 55s. On timeout or missing key, research falls back to a deterministic result and images fall back to branded SVG placeholders. Timed-out requests are aborted, so the app cannot hang on a network failure.

**Q: How do you stop the image model from inventing claims or prices?**
Separation of concerns: factual claims come only from the approved campaign brief; the image prompt controls visual treatment (composition, contrast, headline length, viewing distance). The Risk Agent in BAND additionally rejects variants with unsupported claims.

**Q: Why two OpenAI APIs?**
The Responses API is the native fit for text and image-understanding turns. The Image API is the direct fit for one-shot image creation and lets the app request the billboard's 2:1 output size without an extra conversational model call.

---

## 3. BAND — Agent collaboration & human approval

### 30-second answer
> "BAND is where the campaign gets decided, not just displayed. Five specialist agents — Research, Media Planner, Creative Director, Performance Analyst, and Risk & Brand — post their reasoning into a shared BAND room, surface disagreements, and nothing ships until the human campaign owner explicitly approves. Each specialist is its own registered BAND remote agent with its own API key; the first agent creates the room and recruits the other four."

### Where it lives
- `app/lib/band.ts` — the five agents, room lifecycle, message generation from real campaign data.
- `app/lib/band-client.ts` — BAND Agent REST API client (room creation, recruitment, publishing, approval events).
- `app/app/results/BandDiscussion.tsx` — the visible discussion UI.

### Likely questions

**Q: Are the agents really talking, or is it a scripted transcript?**
The messages are generated deterministically **from the real campaign data** — actual research output, actual location rankings, actual concepts, actual Nimble signals. Change the product or the data and the discussion changes. We chose determinism over free-form LLM chatter so the debate is meaningful, fast, and reproducible, and disagreements are guaranteed to surface rather than depending on model mood.

**Q: What's live on BAND vs local?**
With the five agent API keys configured, the room, recruitment, every message, and the approval event are published to app.band.ai via their Agent REST API — you can open the room in BAND itself. Without keys it degrades to an identical local room, and the UI labels the mode (`live` vs `fallback`).

**Q: Isn't this the same thing as Kylon?**
No — Kylon manages the *workforce*, BAND manages the *decision*. See the dedicated [BAND vs Kylon](#band-vs-kylon-the-question-youll-definitely-get) section for the full framing, side-by-side table, and the "Request approval" handoff that wires them together.

**Q: What can the Risk Agent actually block?**
Unsupported health/performance claims, brand inconsistency, unreadable designs for the viewing distance, and unsuitable placements. Rejections appear in the room and are persisted to InsForge as agent messages.

---

## 4. Kylon — AI workforce management

### 30-second answer
> "Kylon models the persistent AI marketing team. The company context — brand guidelines, personas, approved claims, prohibited language, budget rules — lives in the workspace, and the AI employees execute a six-assignment pipeline: research locations, produce media plans, generate creatives, allocate budget, request approval (which opens the BAND room), and package the final campaign."

### Where it lives
- `app/app/api/kylon/route.ts` — workspace state, company context, assignment pipeline, BAND handoff.
- Machine callers authenticate with `Authorization: Bearer <BILADS_API_KEY>` (`app/lib/apiAuth.ts`).

### Likely questions

**Q: What does Kylon add beyond a to-do list?**
Context plus accountability: assignments execute against the uploaded company context (approved claims constrain creatives; budget rules constrain plans), each assignment is tracked with status and timestamps, and every run is recorded as an `agent_run` in InsForge — an auditable work history for the AI team, not a checklist.

**Q: How does Kylon connect to the rest of the system?**
Assignment 5 ("Request approval") spins up the BAND room and stores the `roomId` in the assignment's handoff — the workforce layer and the decision layer are explicitly linked in data, not just in the pitch.

**Q: Why is Kylon behind an API key?**
`/api/kylon` is a machine endpoint for external agent callers — it accepts only the bearer credential, keeping the workforce API separate from the browser routes.

### How the app is actually connected to Kylon (get this right)

The connection is the **reverse** of the intuitive picture. The app does **not** call out to a hosted Kylon service — there is no Kylon URL, no `KYLON_*` env var, and no outbound `fetch` to Kylon anywhere in the code. Instead:

- **Kylon is an inbound API *on* the Bilads app.** `/api/kylon` ([app/app/api/kylon/route.ts](app/app/api/kylon/route.ts)) is a route hosted inside the app itself. It holds the six-assignment workforce state and exposes `GET` / `POST {start|advance|update}`. The app is the **server**; an external Kylon agent is the **client** that calls in.
- **The link is a shared bearer secret you configure on both sides — not something auto-discovered or auto-published.**
  - You choose a secret and set `BILADS_API_KEY=<secret>` in the app's environment. On the InsForge deployment that means storing it in InsForge's env/secret config. **InsForge does not generate or "publish" this key** — it only *holds* the value as a server-side secret and never exposes it to the browser.
  - Whoever runs Kylon must be handed that **same** secret and configured to send `Authorization: Bearer <secret>` when it POSTs to `https://<your-insforge-app>/api/kylon`.
  - Auth succeeds only when the two strings match (constant-time compare, [apiAuth.ts:81-86](app/lib/apiAuth.ts#L81-L86)); otherwise 401. Browser requests to this route are always rejected — machine-only.
- **InsForge's role is host + secret store, not a Kylon URL.** The Kylon endpoint's address is simply the InsForge deployment URL + `/api/kylon`. The only thing the route sends *to* InsForge is audit records (`startAgentRun`/`finishAgentRun` → one `agent_run` row per action).

**One-sentence version:** *You generate one secret, store it in the app's env via InsForge, and hand the same secret to Kylon so it can authenticate into `/api/kylon` — InsForge hosts the app and holds the secret; it does not issue it or connect anything on its own.*

**Honesty note for the demo:** the repo exposes this authenticated Kylon-facing API, but there is **no live external Kylon instance calling it** in the codebase. The integration is "the app offers a secured Kylon API," not "a running Kylon is currently connected." Separately, the on-screen **KYLON WORKSPACE** panel ([results/page.tsx:1099](app/app/results/page.tsx#L1099)) is derived from local frontend state (`agentPhase`, `creativeBoard`) and does **not** fetch `/api/kylon` — so if asked "is that panel live from the API?", the honest answer is no.

---

## 5. InsForge — Backend & system of record

### 30-second answer
> "InsForge is what makes this a product instead of a demo script. Campaigns, agent runs, the full BAND discussion, approvals, and every generated creative are persisted through the InsForge SDK — creatives upload to InsForge Storage so their URLs are durable. You can close the tab, come back, and reopen the campaign with its complete decision trail."

### Where it lives
- `app/lib/insforge.ts` — server-only admin SDK repository (single seeded `bilads` workspace).
- `migrations/20260714001745_bilads-foundation.sql` — schema: `workspaces`, `campaigns`, `agent_runs`, `creative_variants`, `creative_assets`, `agent_messages`, `approvals`, `outbound_queue_items`.
- `app/lib/images.ts` — uploads generated art to the `generated-creatives` Storage bucket.

### Likely questions

**Q: What exactly is stored?**
Campaigns and their status; every agent run (mode: live / fallback / cache / mixed, with timings); every BAND message via `recordAgentMessage`; human approvals; and creative assets with content hashes. That's a full audit trail from brief to approved campaign.

**Q: Where's user auth?**
Deliberately out of scope for the hackathon build: there are no user accounts. The server-only project-admin key is the sole database principal and nothing InsForge-related ever reaches the browser; browser routes are same-origin-shaped and machine routes use a bearer key. Multi-tenant auth is the obvious next step and the schema already has `workspaces` for it.

**Q: What if InsForge isn't configured?**
The app degrades gracefully — images fall back to local disk, persistence no-ops — but in the deployed demo InsForge is live and required.

---

## Cross-cutting questions

**Q: What's the end-to-end flow, in one breath?**
Upload a product → Kylon assigns the work → the Researcher (OpenAI + Nimble signals) profiles the audience → locations are scored → OpenAI renders location-tailored creatives → the five agents debate in BAND → the human approves → InsForge holds the whole record.

**Q: Why five sponsors — isn't this integration theater?**
Each occupies a different layer with no overlap: data acquisition (Nimble), inference (OpenAI), decision governance (BAND), workforce orchestration (Kylon), persistence (InsForge). Remove any one and a real capability disappears, not a logo.

**Q: What's your reliability story?**
Every external dependency has a timeout and a deterministic fallback: OpenAI → deterministic research / placeholder images; BAND → local room, labeled `fallback`; Nimble → pre-generated dataset; InsForge → local files. The demo cannot dead-end on a network failure, and the UI is honest about which mode it's in.

**Q: Are the reach/conversion numbers predictions?**
No — it's a scenario simulator, not a prediction engine. Conservative / base / optimistic scenarios with every assumption exposed. We deliberately avoid false precision.

**Q: How do you handle targeting ethics?**
Targeting uses only safe attributes (commuting patterns, retail density, foot traffic, interests) — never race or other protected traits. Sensitive categories (employment, housing, lending, health, politics) are restricted, and the Risk Agent flags problematic recommendations.

---

## Honesty box (live vs fallback)

If pressed on "what's real right now," this is the truthful answer — lead with it rather than getting caught:

| Integration | Live path | Demo default |
|---|---|---|
| OpenAI text + vision + images | Live API calls (`OPENAI_API_KEY` set) | **Live**, with deterministic/placeholder fallback on timeout |
| InsForge | Live SDK writes + Storage uploads | **Live** (required) |
| BAND | Real rooms/agents on app.band.ai when the 5 agent keys are set | Live if keys configured; otherwise identical local room, labeled `fallback` |
| Nimble | Live pipeline behind `NIMBLE_API_KEY` refreshes the signal files | Pre-generated signal dataset built from real nearby-business data |
| Kylon | Workforce pipeline exposed as the authenticated `/api/kylon` machine API | In-app workspace state; runs recorded in InsForge |

Framing when asked: *"We chose deterministic fallbacks for everything so the demo is honest about its mode and never hangs — the badge in the UI tells you whether you're seeing the live integration."*
