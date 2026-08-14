# Godson — Data & Persistence Lead

**Role:** Billboard inventory, provenance, committed location signals, production persistence, durable assets, and demo-data reliability.

Godson owns the evidence behind every recommendation and the storage layer that makes campaign work durable. The production system of record is MongoDB Atlas; local JSON and disk storage remain deterministic development fallbacks.

---

## Current Architecture

- **Canonical inventory:** `data/billboards.json`
- **Inventory provenance:** `data/billboards.provenance.json`
- **Traffic model:** `data/traffic-heatmap.json`
- **Committed location intelligence:** `data/signals/*.json`
- **Sample briefs:** `data/samples.ts`
- **Creative demo cache:** `data/cache/*.json`
- **MongoDB connection:** `app/lib/mongodb.ts`
- **Persistence facade:** `app/lib/persistence.ts`
- **MongoDB repositories:** `app/lib/platform/mongo/repositories.ts`
- **GridFS assets:** `app/lib/platform/mongo/gridfs.ts`

When `MONGODB_URI` is configured, campaigns, research, creative generations, agent runs, messages, approvals, workflow state, and asset metadata are stored in MongoDB Atlas. Binary product, creative, and audio assets are stored through GridFS. Without MongoDB, the same application flows use `app/lib/localdb.ts` and local files so development and demos remain usable.

---

## Data Checklist

- [x] Maintain the 14-board San Francisco inventory and shared schema.
- [x] Keep coordinates, costs, impressions, audience tags, and board geometry internally consistent.
- [x] Preserve source provenance for the inventory and explain which values are sourced versus modeled.
- [x] Maintain the 304-point traffic heatmap used by the map UI.
- [x] Keep one committed signal file per board under `data/signals/`.
- [x] Validate signal shape, confidence, source URLs, and `derivedFrom` metadata.
- [x] Ensure `app/lib/signals.ts` can load partial signal data without blocking research.
- [x] Verify location signals influence the Researcher prompt and deterministic fallback findings.
- [x] Keep root data synchronized into `app/lib/` through the existing predev/prebuild sync hook.
- [x] Run `node scripts/validate-data.mjs` after inventory or signal changes.
- [x] Run `node scripts/check-demomatch.mjs` after audience-tag or scoring-input changes.

### Ranking Contract

The ranking math is deterministic:

```text
demoMatch = Jaccard(audience interests, board audienceTags)
targetReach = dailyImpressions * demoMatch
valueScore = (awarenessWeight * dailyImpressions
  + (1 - awarenessWeight) * targetReach * 3) / weeklyCostUsd
```

`awarenessWeight = 1` means pure awareness. Data changes must preserve the documented sample-ranking behavior unless the team intentionally updates the acceptance criteria.

---

## Persistence Checklist

- [x] Use `app/lib/persistence.ts` as the application boundary; feature code should not choose storage backends directly.
- [x] Keep Atlas collections workspace-scoped and campaign-linked.
- [x] Store generated and uploaded binary assets through GridFS, retaining both stable keys and metadata.
- [x] Preserve idempotent campaign, creative, message, and approval writes.
- [x] Keep workflow checkpoint records durable when MongoDB is configured.
- [x] Verify the production connection with `GET /api/health/mongodb`.
- [x] Keep local persistence operational for offline development and deterministic demos.
- [ ] Before a live demo, confirm Atlas connectivity and exercise one campaign save/reopen cycle.
- [ ] Confirm generated creative and approved briefing audio can be read back from GridFS.

---

## Demo Readiness

- Run `node scripts/validate-data.mjs`.
- Run `node scripts/validate-demo-cache.mjs`.
- Confirm `data/signals/index.json` and all per-board signal files are committed.
- Confirm the map shows the expected inventory, heatmap, and top-three ranking changes.
- Confirm the demo remains functional with live inference unavailable by exercising cached and deterministic fallback paths.
- Be ready to distinguish durable Atlas/GridFS storage from the local development fallback.

---

## Q&A Ownership

Godson answers questions about inventory sourcing, provenance, modeled metrics, location-signal confidence, deterministic ranking inputs, MongoDB Atlas collections, GridFS asset durability, and the local fallback strategy.
