# Steven — Frontend & Demo Lead

**Role:** Product UI, map experience, agent theater, creative review, human approval, campaign presentation, and the live demo narrative.

Steven owns what users see and how the architecture is explained on stage. The interface should make deterministic ranking, location evidence, human governance, and graceful fallbacks visible without exposing server credentials or internal provider mechanics.

---

## Current Product Surfaces

| Surface | Current files |
|---|---|
| Campaign intake | `app/app/page.tsx` |
| Campaign history | `app/app/campaigns/page.tsx`, `CampaignList.tsx` |
| Map cockpit | `app/app/map/page.tsx`, `Cockpit.tsx`, `OrangeboardMap.tsx`, `Dossier.tsx` |
| Results experience | `app/app/results/page.tsx` |
| Ranked map and heatmap | `app/app/results/MapView.tsx` |
| Billboard creative composite | `app/app/results/BillboardComposite.tsx` |
| Agent review room | `app/app/results/AgentDiscussion.tsx` |
| Street-level simulation | `app/app/results/SimulationStreetView.tsx` |

---

## Experience Checklist

### Campaign Intake and Research

- [x] Collect product, audience, budget, duration, and awareness-versus-targeting inputs.
- [x] Support deterministic sample campaigns for reliable demos.
- [x] Show staged Researcher and Media Buyer progress without implying that model prose controls rankings.
- [x] Surface relevant findings derived from committed location signals.
- [x] Preserve a useful error and fallback state when live inference is unavailable.

### Map and Location Evidence

- [x] Render the San Francisco billboard inventory and traffic heatmap.
- [x] Re-rank placements client-side when budget or awareness weight changes.
- [x] Explain the selected board using audience fit, cost, impressions, and location evidence.
- [x] Attribute committed location signals accurately without claiming unsupported real-time data.
- [x] Keep the slider reorder moment fast and deterministic.

### Creative and Human Review

- [x] Present two constrained creative concepts and 2:1 artwork generated through Fireworks when configured.
- [x] Composite artwork onto billboard photography while keeping headline and subline as controlled overlays.
- [x] Fall back to cached or deterministic creative output when live generation is unavailable.
- [x] Render the five-agent review room from `AgentDiscussion.tsx`.
- [x] Show that the room is deterministically assembled from real campaign data, rankings, creatives, and location signals.
- [x] Require an explicit human approval or rejection before downstream approved actions.
- [x] Keep status language aligned with `discussing`, `awaiting_approval`, `approved`, and `rejected`.

### Durable Campaign Actions

- [x] Make saved campaigns reopenable from the campaign history surface.
- [x] Treat MongoDB Atlas as the production system of record and local storage as the development fallback.
- [x] Explain that uploaded and generated binary assets are durable through GridFS in production.
- [ ] Connect creative controls to the LangGraph start, status, approve, and reject endpoints so resumable workflow state is visible in the UI.
- [ ] Add approved-briefing audio controls that handle ElevenLabs output, cache hits, and unavailable-audio responses cleanly.
- [x] Keep the OpenRouter Model Lab out of normal browser campaign flows because it is a machine-only evaluation surface.

---

## Demo Script

| Moment | Action | Message |
|---|---|---|
| Open | Select a sample or enter a campaign brief | “Bilads turns a brief into an explainable billboard plan.” |
| Research | Let the agent sequence complete | “Fireworks enriches the plan, while committed location signals ground it.” |
| Ranking | Drag awareness toward targeting | “The rankings reorder instantly because the decision math is deterministic.” |
| Evidence | Open a board dossier and traffic layer | “Every recommendation connects cost, audience fit, traffic, and location evidence.” |
| Creative | Generate or open cached concepts | “The artwork can be live-generated, but the demo remains reliable through cache and deterministic fallbacks.” |
| Review room | Expand the five-agent discussion | “Specialists expose rationale and risk checks before the human decides.” |
| Approval | Approve the plan in the review room | “The final decision stays with the human; the production workflow API also supports resumable LangGraph approval.” |
| Approved outputs | Explain the gated server actions | “Approved briefing audio is verified and cached by the server before it is returned.” |
| Persistence | Reopen the campaign | “MongoDB Atlas and GridFS preserve the campaign record, decisions, and assets.” |
| Close | Return to the final campaign view | “Billboards, decided—with evidence and human control.” |

---

## Rehearsal Checklist

- [ ] Run two complete sample campaigns from intake through creative approval.
- [ ] Confirm the expected top-three boards and slider reorder behavior.
- [ ] Confirm location-signal language matches the committed evidence.
- [ ] Exercise both live Fireworks output and cached/deterministic fallback output.
- [ ] After the workflow controls are connected, approve and reject separate LangGraph runs and verify the UI states.
- [ ] After audio controls are added, generate or retrieve one approved ElevenLabs briefing from the results experience.
- [ ] Reopen a saved campaign and confirm its data and assets remain available.
- [ ] Verify no normal browser action invokes the machine-only Model Lab.
- [ ] Confirm loading, empty, error, and offline states remain presentable.

---

## Q&A Ownership

Steven answers questions about product vision, map-first interaction, deterministic slider behavior, evidence presentation, creative compositing, the five-agent review room, explicit human approval, campaign history, and how the demo remains useful when live services are unavailable.
