# Bilads — data (Godson)

Everything the Media Buyer, map, and creative composites read from. Schema is the
single source of truth in `types.ts` §7; don't rename fields here.

## Files

- `billboards.json` — 14 SF boards, §8 schema. **Coordinates are real** — each board is
  pinned to the nearest SF Planning permit record (see provenance below).
- `billboards.provenance.json` — maps each `id` → the real permit `record_id`, real
  coordinates, real rate-card range, and CPM band it was grounded against. This is the
  answer sheet for the "is this real data?" Q&A.
- `traffic-heatmap.json` — 304 weighted `[lat, lng, intensity]` points for `leaflet.heat`. Regenerate with `node scripts/gen-heatmap.mjs`.
- `samples.ts` — 3 prefill briefs (Volt / Fog City Coffee / Ledgerly).
- `../scripts/gen-heatmap.mjs` — heatmap generator (corridors: 101 / 280 / Market / Mission / Marina).
- `../scripts/check-demomatch.mjs` — sanity check: simulates Researcher interests, prints top-3 per sample under both scoring orientations.

Raw source data (not read by the app; the boards are curated from these):
- `sf-billboards.geojson` / `sf-billboards.csv` — 559 SF Planning General Advertising
  Signs (GAS) permit records with real coordinates, addresses, and modeled rate/CPM ranges.
- `billboard-fiber-businesses.json` — 462 boards with nearby-business enrichment (Google Places), keyed by `record_id`.
- `billboard-deep.json` — one worked example.

## Sources (for the "is this real data?" Q&A)

**Locations are real.** All 14 boards sit on real permitted SF billboard positions —
13 of 14 are within 0.15 mi of a permit record in `sf-billboards.geojson` (the one
exception, `sf-280-dalycity`, is a freeway approach at the county line, ~1.4 mi from the
nearest permitted face; its coordinate is kept as authored). `billboards.provenance.json`
carries each board's source `record_id` and real coordinates.

**Pricing/impressions are modeled but anchored.** `weeklyCostUsd` is cross-checked
against each permit's real `rate_card` range (see `priceFit` in the provenance file): 9
of 14 land inside the range; 4 are slightly above and 1 slightly below, tuned so a ~$3,000
budget filters meaningfully. Demographics eyeballed from Census / DataSF neighborhood
profiles. Impressions/foot-traffic are order-of-magnitude estimates consistent with OOH
vendor listings (AdQuick / Blip). Roadmap answer: the schema already matches what live
inventory APIs return; grounding on real permit records is the first step.

## ⚠️ Contract flag for Noriaki — §5 scoring formula naming is inverted

`CampaignParams.awarenessWeight` says **"1 = pure awareness"**, but the §5 formula
`valueScore = ((1-w)*dailyImpressions + w*targetReach*3)/weeklyCostUsd` makes **w=1
weight targetReach** (i.e. *targeted*, not awareness). Naming and math disagree.

The data is tuned to the **documented field meaning** (w=1 = awareness = raw
impressions per dollar), i.e. this form:

```
valueScore = (w*dailyImpressions + (1-w)*targetReach*3) / weeklyCostUsd
```

Recommend backend adopt this form so the slider label matches behavior. If backend
keeps the literal §5 formula instead, the frontend must pass `w = 1 - awarenessWeight`.
Either fix works — just pick one and note it in team chat (per §7.8). Left unresolved,
the "targeted" end of the slider ranks a low-fit board (Mission, demoMatch 0.10) #1,
which reads as broken on stage.

## demoMatch sanity check (intended formula, default slider positions)

| Sample | Budget | Top 3 |
|---|---|---|
| Volt — awareness (w .7) | $3000 | 101 Vermont · 24th/Mission · Harrison |
| Volt — targeted (w .15) | $3000 | 101 Vermont · Harrison · Chestnut/Marina |
| Fog City Coffee (w .35) | $2200 | 24th/Mission · Valencia · 3rd/Dogpatch |
| Ledgerly SaaS (w .5) | $3500 | Montgomery/FiDi · Market/Powell · 101 Vermont |

Dragging Volt awareness→targeted swaps Mission out for Marina and lifts Harrison —
that's the on-stage "slider reorders the pins" moment (§13.4). Sunset is deliberately
low-fit for Volt and never enters its top 3 (stays in the data, not featured — §8).

## ⚠️ adCorners are demo annotations — still need seller/photo verification

The current `/public/billboards/<id>.jpg` assets are Street View frames selected
for demo visibility, and each board's `adCorners` is an approximate `[TL, TR, BR,
BL]` quad over the visible ad/sign face in that frame. This is good enough for a
demo mockup, but still not seller-grade production inventory. To finish (§ Godson
1:00–2:00):

1. Collect or license one seller-approved photo per `id` with a big front-facing rectangular board → save as `/public/billboards/<id>.jpg`.
2. Open each, read the 4 blank-board corner pixels in **TL, TR, BR, BL** order, overwrite `adCorners`.
3. Hand one photo + corners to Steven for a composite smoke-test before annotating the rest.

Sample product images also still need generating → `/public/samples/{volt,fog-city,ledgerly}.png` (paths already referenced in `samples.ts`).

## Tag vocabulary (keep audienceTags drawing from this so Jaccard overlaps land)

commuters · tech · office workers · professionals · finance · startups ·
young professionals · fitness · outdoors · eco-conscious · affluent · creatives ·
foodies · coffee · nightlife · walkable · latino · families · students · suburban ·
value-seekers · tourists · shoppers

If a winner ever looks wrong, adjust `audienceTags`, **not** the scoring math (§8).
