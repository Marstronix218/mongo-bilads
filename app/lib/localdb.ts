import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Local single-workspace system of record.
 * Rows live in app/.data/db.json and uploaded files under app/public/storage,
 * so the whole workflow runs on localhost with no external services. The
 * idempotency and status-transition rules mirror the original SQL functions
 * (see migrations/20260714001745 in the project history).
 */

export const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export const WORKSPACE_SLUG = "bilads";

export interface StoredFile {
  bucket: string;
  url: string;
  key: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export type AgentExecutionMode = "live" | "fallback" | "cache" | "mixed";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  workspace_id: string;
  campaign_id: string | null;
  status: AgentRunStatus;
  started_at: string | null;
}

export interface CampaignRow {
  id: string;
  workspace_id: string;
  client_request_id: string;
  sample_id: string | null;
  product_name: string;
  product_description: string;
  target_audience: string;
  weekly_budget_usd: number;
  campaign_weeks: number;
  awareness_weight: number;
  status: "draft" | "researched" | "designed" | "simulated" | "archived";
  research_result: unknown | null;
  opened_board_ids: string[];
  created_at: string;
  updated_at: string;
}

interface AgentRunRow extends AgentRun {
  initiated_by_subject: string;
  request_id: string;
  agent: string;
  model: string | null;
  input_hash: string;
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown> | null;
  execution_mode: AgentExecutionMode;
  error_code: string | null;
  error_detail: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

interface AgentMessageRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  agent_run_id: string;
  room_id: string;
  sender_kind: "agent" | "human" | "system";
  agent_name: string | null;
  role_label: string | null;
  actor_subject: string | null;
  body: string;
  action: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface CreativeVariantRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  idempotency_key: string;
  billboard_id: string;
  generation: number;
  position: number;
  concept_key: string;
  consistent_brand: boolean;
  language: string;
  headline: string;
  subline: string;
  rationale: string;
  source: string;
  created_at: string;
}

interface CreativeAssetRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  creative_variant_id: string | null;
  asset_kind: "product_source" | "generated_art" | "billboard_mockup";
  bucket_name: string;
  object_key: string;
  storage_url: string;
  mime_type: string;
  byte_size: number | null;
  sha256: string | null;
  created_at: string;
}

interface ApprovalRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  room_id: string | null;
  decision: "approved" | "rejected" | "edited";
  decided_by_subject: string;
  note: string | null;
  context: Record<string, unknown>;
  request_id: string;
  decided_at: string;
}

interface Db {
  campaigns: CampaignRow[];
  agent_runs: AgentRunRow[];
  agent_messages: AgentMessageRow[];
  creative_variants: CreativeVariantRow[];
  creative_assets: CreativeAssetRow[];
  approvals: ApprovalRow[];
}

// process.cwd() is app/ when started there, repo root otherwise.
function appDir(): string {
  return existsSync(join(process.cwd(), "public")) ? process.cwd() : join(process.cwd(), "app");
}

const dbFile = () => join(appDir(), ".data", "db.json");
const storageRoot = () => join(appDir(), "public", "storage");

let cache: Db | null = null;

function load(): Db {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(dbFile(), "utf8")) as Db;
  } catch {
    cache = {
      campaigns: [],
      agent_runs: [],
      agent_messages: [],
      creative_variants: [],
      creative_assets: [],
      approvals: [],
    };
  }
  return cache;
}

function save(db: Db): void {
  const file = dbFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file);
}

function now(): string {
  return new Date().toISOString();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

// ─── File storage ────────────────────────────────────────────────────────────

/** Object keys are app-generated but re-enter through URLs, so keep a guard. */
function safeStoragePath(bucket: string, key: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(bucket)) throw new Error(`invalid bucket: ${bucket}`);
  if (key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`invalid object key: ${key}`);
  }
  return join(storageRoot(), bucket, key);
}

export async function uploadFile(
  bucket: string,
  key: string,
  bytes: Buffer,
  mimeType = "application/octet-stream"
): Promise<StoredFile> {
  const path = safeStoragePath(bucket, key);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return {
    bucket,
    url: `/storage/${bucket}/${key}`,
    key,
    mimeType,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function downloadFile(bucket: string, key: string): Promise<Buffer | null> {
  const path = safeStoragePath(bucket, key);
  return existsSync(path) ? readFileSync(path) : null;
}

export async function removeFile(bucket: string, key: string): Promise<void> {
  rmSync(safeStoragePath(bucket, key), { force: true });
}

// ─── Agent runs and messages ─────────────────────────────────────────────────

export async function startAgentRun(args: {
  campaignId?: string;
  /** Unverified caller label ("shared-web", "kylon"), never a user id. */
  initiatedBySubject: string;
  requestId: string;
  agent: string;
  model?: string;
  input: Record<string, unknown>;
  executionMode?: AgentExecutionMode;
}): Promise<AgentRun> {
  const db = load();
  const campaignId = args.campaignId ?? null;
  const existing = db.agent_runs.find(
    (run) => run.campaign_id === campaignId && run.request_id === args.requestId && run.agent === args.agent
  );
  if (existing) return existing;

  const timestamp = now();
  const inputJson = stableJson(args.input);
  const row: AgentRunRow = {
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    campaign_id: campaignId,
    initiated_by_subject: args.initiatedBySubject,
    request_id: args.requestId,
    agent: args.agent,
    model: args.model ?? null,
    input_hash: createHash("sha256").update(inputJson).digest("hex"),
    input_summary: args.input,
    output_summary: null,
    execution_mode: args.executionMode ?? "live",
    status: "running",
    error_code: null,
    error_detail: null,
    started_at: timestamp,
    finished_at: null,
    duration_ms: null,
    created_at: timestamp,
  };
  db.agent_runs.push(row);
  save(db);
  return row;
}

const TERMINAL: AgentRunStatus[] = ["succeeded", "failed", "cancelled"];

export async function finishAgentRun(args: {
  run: AgentRun;
  status: "succeeded" | "failed" | "cancelled";
  output?: Record<string, unknown>;
  executionMode?: AgentExecutionMode;
  errorCode?: string;
  errorDetail?: string;
}): Promise<void> {
  if (TERMINAL.includes(args.run.status)) return;
  const db = load();
  const row = db.agent_runs.find((run) => run.id === args.run.id);
  if (!row || TERMINAL.includes(row.status)) return;

  const finishedAt = new Date();
  const startedAt = row.started_at ? new Date(row.started_at) : finishedAt;
  row.status = args.status;
  row.output_summary = args.output ?? null;
  if (args.executionMode) row.execution_mode = args.executionMode;
  row.error_code = args.status === "failed" ? args.errorCode ?? "agent_failed" : null;
  row.error_detail =
    args.status === "failed" ? (args.errorDetail ?? "Agent execution failed").slice(0, 2000) : null;
  row.finished_at = finishedAt.toISOString();
  row.duration_ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
  save(db);
}

export async function recordAgentMessage(args: {
  campaignId: string;
  agentRunId: string;
  roomId: string;
  senderKind: "agent" | "human" | "system";
  agentName?: string;
  roleLabel?: string;
  /** Unverified caller label; there is no authenticated user identity. */
  actorSubject?: string;
  body: string;
  action?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = load();
  db.agent_messages.push({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    campaign_id: args.campaignId,
    agent_run_id: args.agentRunId,
    room_id: args.roomId,
    sender_kind: args.senderKind,
    agent_name: args.agentName ?? null,
    role_label: args.roleLabel ?? null,
    actor_subject: args.actorSubject ?? null,
    body: args.body,
    action: args.action ?? null,
    metadata: args.metadata ?? {},
    created_at: now(),
  });
  save(db);
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  return load().campaigns.find((campaign) => campaign.id === campaignId) ?? null;
}

export async function listCampaigns(limit = 100): Promise<CampaignRow[]> {
  return [...load().campaigns]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}

export async function createCampaign(args: {
  clientRequestId: string;
  sampleId?: string | null;
  productName: string;
  productDescription: string;
  targetAudience: string;
  weeklyBudgetUsd: number;
  campaignWeeks: number;
  awarenessWeight: number;
}): Promise<CampaignRow> {
  const db = load();
  const sampleId = args.sampleId?.trim() || null;
  const productName = args.productName.trim();

  const existing = db.campaigns.find((campaign) => campaign.client_request_id === args.clientRequestId);
  if (existing) {
    if (
      existing.product_name !== productName ||
      existing.product_description !== args.productDescription ||
      existing.target_audience !== args.targetAudience ||
      Number(existing.weekly_budget_usd) !== args.weeklyBudgetUsd ||
      Number(existing.campaign_weeks) !== args.campaignWeeks ||
      Number(existing.awareness_weight) !== args.awarenessWeight ||
      existing.sample_id !== sampleId
    ) {
      throw new Error("clientRequestId already belongs to different campaign data");
    }
    return existing;
  }

  const timestamp = now();
  const row: CampaignRow = {
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    client_request_id: args.clientRequestId,
    sample_id: sampleId,
    product_name: productName,
    product_description: args.productDescription,
    target_audience: args.targetAudience,
    weekly_budget_usd: args.weeklyBudgetUsd,
    campaign_weeks: args.campaignWeeks,
    awareness_weight: args.awarenessWeight,
    status: "draft",
    research_result: null,
    opened_board_ids: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.campaigns.push(row);
  save(db);
  return row;
}

export async function setCampaignResearch(
  campaignId: string,
  research: Record<string, unknown>
): Promise<CampaignRow> {
  const db = load();
  const campaign = db.campaigns.find((row) => row.id === campaignId);
  if (!campaign) throw new Error("campaign not found");
  if (campaign.status !== "draft" && campaign.status !== "researched") {
    throw new Error("research cannot be changed after creative work begins");
  }
  campaign.research_result = research;
  if (campaign.status === "draft") campaign.status = "researched";
  campaign.updated_at = now();
  save(db);
  return campaign;
}

// ─── Creative assets and variants ────────────────────────────────────────────

export async function recordProductAsset(args: {
  campaignId: string;
  stored: StoredFile;
}): Promise<void> {
  const db = load();
  if (args.stored.bucket !== "product-assets") throw new Error("product assets must use product-assets");
  if (!db.campaigns.some((campaign) => campaign.id === args.campaignId)) {
    throw new Error("campaign not found");
  }

  const existing = db.creative_assets.find(
    (asset) => asset.bucket_name === args.stored.bucket && asset.object_key === args.stored.key
  );
  if (existing) {
    if (existing.campaign_id !== args.campaignId || existing.sha256 !== args.stored.sha256) {
      throw new Error("storage key already belongs to different content");
    }
    return;
  }

  db.creative_assets.push({
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    campaign_id: args.campaignId,
    creative_variant_id: null,
    asset_kind: "product_source",
    bucket_name: args.stored.bucket,
    object_key: args.stored.key,
    storage_url: args.stored.url,
    mime_type: args.stored.mimeType,
    byte_size: args.stored.byteSize,
    sha256: args.stored.sha256,
    created_at: now(),
  });
  save(db);
}

export interface CreativeConcept {
  id: string;
  language: string;
  headline: string;
  subline?: string;
  rationale?: string;
  position: number;
  asset?: { bucket: string; key: string; url: string; mimeType?: string; byteSize?: number; sha256?: string };
}

export async function saveCreativeGeneration(args: {
  campaignId: string;
  idempotencyKey: string;
  billboardId: string;
  generation: number;
  consistentBrand: boolean;
  source: string;
  concepts: CreativeConcept[];
}): Promise<string[]> {
  const db = load();
  if (args.concepts.length < 1 || args.concepts.length > 2) {
    throw new Error("concepts must contain one or two items");
  }
  const campaign = db.campaigns.find((row) => row.id === args.campaignId);
  if (!campaign || (campaign.status !== "researched" && campaign.status !== "designed")) {
    throw new Error("creative generation requires a researched, active campaign");
  }

  const ids: string[] = [];
  for (const [expected, concept] of args.concepts.entries()) {
    if (concept.position !== expected) throw new Error("concept positions must be ordered from zero");

    let variant = db.creative_variants.find(
      (row) =>
        row.campaign_id === args.campaignId &&
        row.idempotency_key === args.idempotencyKey &&
        row.position === concept.position
    );
    if (variant) {
      if (variant.headline !== concept.headline || variant.billboard_id !== args.billboardId) {
        throw new Error("idempotency key already belongs to different creative data");
      }
    } else {
      variant = {
        id: randomUUID(),
        workspace_id: WORKSPACE_ID,
        campaign_id: args.campaignId,
        idempotency_key: args.idempotencyKey,
        billboard_id: args.billboardId,
        generation: args.generation,
        position: concept.position,
        concept_key: concept.id,
        consistent_brand: args.consistentBrand,
        language: concept.language,
        headline: concept.headline,
        subline: concept.subline ?? "",
        rationale: concept.rationale ?? "",
        source: args.source,
        created_at: now(),
      };
      db.creative_variants.push(variant);
    }
    ids.push(variant.id);

    const asset = concept.asset;
    if (asset?.key && asset.bucket === "generated-creatives") {
      const exists = db.creative_assets.some(
        (row) => row.bucket_name === asset.bucket && row.object_key === asset.key
      );
      if (!exists) {
        db.creative_assets.push({
          id: randomUUID(),
          workspace_id: WORKSPACE_ID,
          campaign_id: args.campaignId,
          creative_variant_id: variant.id,
          asset_kind: "generated_art",
          bucket_name: asset.bucket,
          object_key: asset.key,
          storage_url: asset.url,
          mime_type: asset.mimeType || "image/png",
          byte_size: asset.byteSize ?? null,
          sha256: asset.sha256 ?? null,
          created_at: now(),
        });
      }
    }
  }

  if (campaign.status === "researched") campaign.status = "designed";
  campaign.updated_at = now();
  save(db);
  return ids;
}

// ─── Approvals ───────────────────────────────────────────────────────────────

export async function recordApproval(args: {
  campaignId: string;
  roomId?: string | null;
  decision: "approved" | "rejected" | "edited";
  decidedBySubject: string;
  note?: string | null;
  context?: Record<string, unknown>;
  requestId: string;
}): Promise<ApprovalRow> {
  const db = load();
  const campaign = db.campaigns.find((row) => row.id === args.campaignId);
  if (!campaign || !["researched", "designed", "simulated"].includes(campaign.status)) {
    throw new Error("approval requires a researched, active campaign");
  }

  const existing = db.approvals.find(
    (row) => row.campaign_id === args.campaignId && row.request_id === args.requestId
  );
  if (existing) {
    if (existing.decision !== args.decision || existing.room_id !== (args.roomId || null)) {
      throw new Error("request_id already belongs to a different approval");
    }
    return existing;
  }

  const row: ApprovalRow = {
    id: randomUUID(),
    workspace_id: WORKSPACE_ID,
    campaign_id: args.campaignId,
    room_id: args.roomId || null,
    decision: args.decision,
    decided_by_subject: args.decidedBySubject,
    note: args.note || null,
    context: args.context ?? {},
    request_id: args.requestId,
    decided_at: now(),
  };
  db.approvals.push(row);
  save(db);
  return row;
}
