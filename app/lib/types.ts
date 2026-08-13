// AUTO-GENERATED from types.ts by scripts/sync-frontend-data.mjs — do not edit here.
// Edit the source, then `npm run sync` (runs automatically on predev/prebuild).

/**
 * Bilads — shared data contracts (single source of truth).
 *
 * Derived from PRD v4 §7. Everyone imports from this file; nothing that crosses
 * a boundary (API request/response, data file, shared enum) is defined anywhere
 * else. If reality diverges from this file, update PRD §7 first, then this file
 * (change protocol: PRD §7.8 — Godson merges).
 *
 * Contents:
 *   A. Shared domain types        (§7.1)
 *   B. API contracts              (§7.2 /api/research, §7.3 /api/generate)
 *   C. Curated data-file types    (§7.4 billboards.json, §7.5 samples, §7.6 heatmap)
 *   D. Simulation (client-only)   (§7.7)
 *   E. Raw source-data types      (the files that actually live in /data today)
 *   F. Curation mapping           (raw permit record -> curated Billboard)
 *
 * Rules (PRD §7):
 *   - Enums are string unions (no TS `enum`) for tree-shaking + JSON parity.
 *   - Every field has an explicit type; no `any`.
 *   - Nothing is optional unless the spec says so.
 *   - Field names are exact — do not rename in code.
 */

/* ============================================================================
 * A. Shared domain types (PRD §7.1)
 * ========================================================================== */

/** Language codes we support in ad copy. */
export type Language = "en" | "es";

/** What kind of traffic passes the board. */
export type TrafficType = "vehicle" | "foot" | "foot+vehicle";

/** User-facing brief (form state on the landing page). */
export interface ProductBrief {
    productName: string;
    description: string;
    /** free-text target audience */
    audience: string;
    /** product image, optional */
    imageBase64?: string;
}

/** Campaign parameters set on the landing page alongside the brief. */
export interface CampaignParams {
    /** e.g. 3000 */
    weeklyBudgetUsd: number;
    /** integer, default 4 */
    campaignWeeks: number;
    /** 0..1, 0 = pure targeted, 1 = pure awareness */
    awarenessWeight: number;
}

/** The Researcher agent's understanding of who to advertise to. */
export interface AudienceProfile {
    /** "25-40" */
    ageRange: string;
    /** "$60k-$120k" */
    income: string;
    /** tags used for demoMatch (Jaccard vs board.audienceTags) */
    interests: string[];
    /** one short sentence */
    mindset: string;
}

/* ============================================================================
 * B. API contracts
 * ========================================================================== */

/* --- B.1  POST /api/research (PRD §7.2) -----------------------------------
 * Runs Researcher then Media Buyer server-side; returns both blocks in one
 * response. Client animates them sequentially. Returns ALL boards so slider /
 * budget changes re-filter and re-rank client-side without a new API call.
 */

export interface ResearchRequest {
    /** durable InsForge campaign owned by the current user */
    campaignId: string;
    /** idempotency key for the agent run */
    requestId: string;
    brief: ProductBrief;
    campaign: CampaignParams;
}

/** One item per board, all boards included, sorted by valueScore desc. */
export interface BoardRanking {
    /** matches Billboard.id */
    id: string;
    /** valueScore, deterministic (see PRD §5) */
    score: number;
    /** 0..1, Jaccard(audienceProfile.interests, board.audienceTags) */
    demoMatch: number;
    /** <= 15 words, LLM-written */
    reason: string;
    /** board.weeklyCostUsd <= campaign.weeklyBudgetUsd */
    inBudget: boolean;
}

export interface ResearchResponse {
    researcher: {
        audienceProfile: AudienceProfile;
        /** exactly 3 */
        buyingTriggers: string[];
        /** one paragraph */
        adToneGuidance: string;
        /** exactly 4, for typewriter reveal */
        findings: string[];
    };
    mediaBuyer: {
        /** ALL boards, sorted by valueScore desc */
        rankings: BoardRanking[];
        /** first 3 board ids where inBudget === true */
        top3: string[];
        /** exactly 4 */
        findings: string[];
    };
}

/* --- B.2  POST /api/generate (PRD §7.3) -----------------------------------
 * Runs Creative Director once, produces two concepts, generates two images in
 * parallel.
 */

export interface GenerateRequest {
    /** durable InsForge campaign owned by the current user */
    campaignId: string;
    /** idempotency key for this generation */
    requestId: string;
    billboardId: string;
    brief: ProductBrief;
    audienceProfile: AudienceProfile;
    /** true = same visual identity across boards */
    consistentBrand: boolean;
    /** increments on Regenerate, default 0 */
    variant?: number;
}

export interface AdConcept {
    /** stable within a response, e.g. "concept-0" */
    id: string;
    language: Language;
    /** <= 7 words */
    headline: string;
    /** <= 10 words */
    subline: string;
    /** /public path or full URL to the generated ad art */
    imageUrl: string;
    /** durable InsForge Storage metadata, present for newly rendered art */
    asset?: {
        bucket: string;
        key: string;
        url: string;
        mimeType: string;
        byteSize: number;
        sha256: string;
    };
    /** <= 15 words, why this concept for this board */
    rationale: string;
}

export interface GenerateResponse {
    /** exactly 2 */
    concepts: AdConcept[];
}

/* ============================================================================
 * C. Curated data-file types
 * ========================================================================== */

/* --- C.1  Billboard — data/billboards.json (PRD §7.4 / §8) ----------------
 * Array of 12-15 curated entries. Input to the Media Buyer; source for map
 * pins, info cards, and creative composites. This is a hand-curated marketing
 * shape, NOT the raw permit record (see section E + F for the raw source and
 * the mapping that produces this).
 */

/** TL, TR, BR, BL pixel coords of the blank board in the photo. */
export type AdCorners = [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
];

export interface Billboard {
    /** slug, e.g. "sf-mission-24th" */
    id: string;
    /** human-readable, e.g. "24th St @ Mission" */
    name: string;
    lat: number;
    lng: number;
    /** "/billboards/<id>.jpg" */
    photo: string;
    adCorners: AdCorners;
    dailyImpressions: number;
    trafficType: TrafficType;
    avgDwellSeconds: number;
    weeklyCostUsd: number;
    /** e.g. "Mission" */
    neighborhood: string;
    /** triggers EN+ES concepts */
    spanishFriendly: boolean;
    /** used for demoMatch (Jaccard vs audienceProfile.interests) */
    audienceTags: string[];
    demographics: {
        medianAge: number;
        medianIncome: number;
        footTrafficDaily: number;
        hispanicSharePct: number;
    };
}

/** The whole data/billboards.json file. */
export type BillboardsFile = Billboard[];

/* --- C.2  Sample products — data/samples.ts (PRD §7.5) --------------------
 * Clicking a sample card sets the entire landing-page form state to
 * { ...sample.brief, ...sample.campaign } and previews productImagePath.
 */

export interface SampleProduct {
    /** "volt" | "fog-city" | "ledgerly" */
    id: string;
    /** "Volt E-Bikes" */
    label: string;
    brief: ProductBrief;
    /** suggested defaults for this sample */
    campaign: CampaignParams;
    /** "/samples/volt.png" */
    productImagePath: string;
}

/* --- C.3  Traffic heatmap — data/traffic-heatmap.json (PRD §7.6) ----------
 * Feed directly to leaflet.heat's addLayer.
 */

export type HeatmapPoint = [lat: number, lng: number, intensity: number];
/** 200-400 points. */
export type HeatmapData = HeatmapPoint[];

/* ============================================================================
 * D. Simulation — client-only, no API (PRD §7.7)
 * ========================================================================== */

export interface SimulationInput {
    /** one per selected concept */
    boards: Billboard[];
    /** parallel array, same length as boards */
    demoMatches: number[];
    campaignWeeks: number;
    /** default 1800 (Volt e-bike order) */
    assumedOrderValueUsd?: number;
}

export interface DailyPoint {
    /** 1..(campaignWeeks*7) */
    day: number;
    impressions: number;
    targetReach: number;
    cumImpressions: number;
    cumTargetReach: number;
}

export interface SimulationOutput {
    days: DailyPoint[];
    totalImpressions: number;
    totalSpendUsd: number;
    blendedCpmUsd: number;
    estimatedConversions: number;
    /** costPerConversion */
    estimatedCpaUsd: number;
    /** rendered in the mono footer */
    assumptions: string[];
}

/* Formulas (PRD §5 / §7.7), carried here so consumers don't reinvent them:
 *   dailyImpressions_d = board.dailyImpressions * (0.9 + Math.random() * 0.2)
 *   reach              = cumImpressions * 0.6
 *   targetReach        = reach * demoMatch
 *   conversions        = targetReach * 0.0005
 *   costPerConversion  = (Σ board.weeklyCostUsd * campaignWeeks) / conversions
 */

/* ============================================================================
 * E. Raw source-data types — the files that actually live in /data
 * ----------------------------------------------------------------------------
 * These are NOT part of §7. They describe the pre-scraped source data Godson
 * collected, which the curation step (section F) converts into Billboard[].
 * The frontend/API should never read these directly — they consume the curated
 * types above. Typed here so the curation script (and anyone spelunking the
 * raw data) has a contract.
 * ========================================================================== */

/** Confidence tag on modeled buying metadata. */
export type BuyingDataConfidence = "estimated" | "seller-confirmed" | "verified";

/**
 * One SF Planning "General Advertising Signs" permit record.
 * Shape of a feature's `properties` in data/sf-billboards.geojson and of a row
 * in data/sf-billboards.csv (559 records). Many fields are permit bookkeeping;
 * the buying_* / rate_card / estimated_cpm / dimensions fields are modeled
 * estimates layered on top. Null is common — treat every string field as
 * possibly null except record_id / address / record_status.
 */
export interface RawBillboardPermit {
    OBJECTID: number;
    ORIG_FID: number | null;
    /** SF Planning permit id, e.g. "2020-000659GAS" — the join key */
    record_id: string;
    record_name: string | null;
    address: string;
    date_opened: string | null;
    date_closed: string | null;
    record_status: string;
    record_status_date: string | null;
    record_type: string | null;
    record_type_category: string | null;
    record_type_group: string | null;
    record_type_subtype: string | null;
    record_type_type: string | null;
    record_type_4level: string | null;
    description: string | null;
    module: string | null;
    templateid: string | null;
    application_type: string | null;
    mod_record_number: string | null;
    parent: string | null;
    children: string | null;
    constructcost: number | null;
    /** permit planner contact */
    planner_id: string | null;
    planner_name: string | null;
    planner_email: string | null;
    planner_phone: string | null;
    acalink: string | null;
    aalink: string | null;
    PHOTOTOUSE: string | null;
    /** --- modeled buying metadata (estimates; verify before booking) --- */
    owner_seller: string | null;
    /** e.g. "Est. 12 ft x 25 ft poster/bulletin; seller to confirm" */
    dimensions: string | null;
    facing: string | null;
    /** e.g. "Est. $4k-$10k / 4 weeks" */
    rate_card: string | null;
    /** e.g. "Est. $6-$14 CPM" */
    estimated_cpm: string | null;
    availability: string | null;
    lighting: string | null;
    /** e.g. "Static" | "Digital" */
    media_type: string | null;
    restrictions: string | null;
    booking_contact: string | null;
    buying_data_source: string | null;
    buying_data_confidence: BuyingDataConfidence | string;
}

/** A GeoJSON Point feature carrying a permit record. */
export interface RawBillboardFeature {
    type: "Feature";
    geometry: {
        type: "Point";
        /** [lng, lat] per GeoJSON order */
        coordinates: [number, number];
    };
    properties: RawBillboardPermit;
}

/** data/sf-billboards.geojson */
export interface RawBillboardFeatureCollection {
    type: "FeatureCollection";
    features: RawBillboardFeature[];
}

/**
 * A nearby business (Google Places) used to characterize a board's surroundings
 * — the raw signal behind curated audienceTags / demographics.
 */
export interface NearbyBusiness {
    placeId: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    description: string | null;
    website: string | null;
    rating: number | null;
    numReviews: number;
    primaryType: string | null;
    allTypes: string[];
    /** Google price level 0-4, if known */
    priceLevel: number | null;
    phoneNumber: string | null;
    countryIsoCode: string | null;
    googleMapsURL: string | null;
}

/** One billboard's nearby-business enrichment, keyed by permit record_id. */
export interface BillboardBusinesses {
    record_id: string;
    address: string;
    lng: number;
    lat: number;
    search_query: string;
    radius_miles: number;
    businesses: NearbyBusiness[];
    fetched_at: string;
}

/** data/billboard-fiber-businesses.json (462 boards keyed by record_id). */
export interface FiberBusinessesFile {
    generated_at: string;
    billboards: Record<string, BillboardBusinesses>;
}

/** data/billboard-deep.json — a single worked example (one board + businesses). */
export interface BillboardDeepFile {
    billboard: {
        record_id: string;
        lat: number;
        lng: number;
        note: string;
    };
    businesses: NearbyBusiness[];
}

/* ============================================================================
 * F. Curation mapping — how raw source data becomes a curated Billboard
 * ----------------------------------------------------------------------------
 * Not runtime code; a documented contract for the offline curation step
 * (PRD §8, "Godson — data"). Consumers only ever see Billboard (section C).
 *
 *   Billboard.id                 <- slug(RawBillboardPermit.record_name/address)
 *   Billboard.name               <- RawBillboardPermit.record_name / address
 *   Billboard.lat / lng          <- feature.geometry.coordinates (reversed)
 *   Billboard.weeklyCostUsd      <- parsed midpoint of rate_card, normalized /week
 *   Billboard.trafficType        <- inferred from location + facing
 *   Billboard.neighborhood       <- reverse-geocoded from lat/lng
 *   Billboard.audienceTags       <- derived from NearbyBusiness.primaryType/allTypes
 *   Billboard.demographics        <- Census/DataSF by tract + nearby-business mix
 *   Billboard.dailyImpressions   <- modeled from estimated_cpm + traffic
 *   Billboard.spanishFriendly    <- demographics.hispanicSharePct threshold
 *   Billboard.photo / adCorners  <- Street View screenshot + manual annotation
 *
 * `record_id` is the join key between RawBillboardPermit and BillboardBusinesses.
 * Anything the raw data can't supply (photo, adCorners, dailyImpressions) is
 * hand-curated per PRD §8 — plausible beats precise.
 */

/* ============================================================================
 * G. Sponsor data — Nimble location signals (GODSON.md Phase 3)
 * ----------------------------------------------------------------------------
 * Per-board location intelligence the Research Agent folds into its context.
 * Files live at data/nimble-signals/<boardId>.json (+ index.json). Pre-API,
 * these are derived from real Google Places nearby-business data; the live
 * Nimble pipeline augments `signals` and populates `source_urls`.
 * ========================================================================== */

export interface NimbleSignal {
    /** matches Billboard.id */
    boardId: string;
    /** human-readable, e.g. "24th St @ Mission (Mission)" */
    location: string;
    /** short intelligence bullets for the Researcher's context */
    signals: string[];
    /** evidence links; empty until the live Nimble pipeline fills them */
    source_urls: string[];
    /** 0..1, higher when backed by more real nearby-business data */
    confidence: number;
    /** provenance of the signals, e.g. "google-places-nearby (real)" */
    derivedFrom: string;
    /** count of real nearby businesses the signals were built from */
    nearbyBusinessCount: number;
}

/* ============================================================================
 * H. Sponsor data — InsForge persistence schema (GODSON.md Phase 3)
 * ----------------------------------------------------------------------------
 * Storage contract for campaigns, generated creatives, agent-run logs, and the
 * human approval trail. Backend (Noriaki) implements CRUD against InsForge;
 * these types are the shared row shapes. All ids are InsForge-assigned strings.
 * ========================================================================== */

export type CampaignStatus = "draft" | "researched" | "designed" | "simulated" | "archived";
export type AgentName = "researcher" | "mediaBuyer" | "creativeDirector";
export type ApprovalDecision = "approved" | "rejected" | "edited";

/** One saved campaign — the "reopen campaign" flow reads these back. */
export interface CampaignRecord {
    id: string;
    workspaceId: string;
    createdAt: string; // ISO timestamp
    updatedAt: string; // ISO timestamp
    /** optional sample this was prefilled from ("volt" | "fog-city" | "ledgerly") */
    sampleId?: string;
    brief: ProductBrief;
    campaign: CampaignParams;
    status: CampaignStatus;
    /** cached Media Buyer output for this campaign, if research has run */
    research?: ResearchResponse;
    /** board ids the user actually opened / designed for */
    openedBoardIds: string[];
}

/** A generated creative set for one board within a campaign. */
export interface CreativeRecord {
    id: string;
    campaignId: string;
    billboardId: string;
    variant: number;
    consistentBrand: boolean;
    concepts: AdConcept[]; // exactly 2, as returned by /api/generate
    createdAt: string;
}

/** One agent invocation, for observability + the "agent run logs" trail. */
export interface AgentRunRecord {
    id: string;
    campaignId: string;
    agent: AgentName;
    model: string; // GMI model id used
    /** hash of the input payload, for dedupe / cache-hit inspection */
    inputHash: string;
    /** raw JSON string the agent returned (post-parse), for auditing */
    output: string;
    startedAt: string;
    finishedAt: string;
    ok: boolean;
    /** true if the deterministic fallback path produced this result */
    fallbackUsed: boolean;
}

/** Human decision on an agent recommendation (approval trail). */
export interface ApprovalRecord {
    id: string;
    campaignId: string;
    /** board the decision applies to; absent = campaign-level decision */
    billboardId?: string;
    decision: ApprovalDecision;
    decidedBy: string; // user identifier
    note?: string;
    decidedAt: string;
}
