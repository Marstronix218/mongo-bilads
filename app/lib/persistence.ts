import "server-only";

import { randomUUID } from "node:crypto";
import { mongoDatabase } from "./mongodb";
import * as local from "./localdb";
import { createMongoRepositories } from "./platform/mongo/repositories";
import * as gridfs from "./platform/mongo/gridfs";

export const WORKSPACE_ID = local.WORKSPACE_ID;
export const WORKSPACE_SLUG = local.WORKSPACE_SLUG;

export type StoredFile = local.StoredFile & { id?: string };
export type AgentExecutionMode = local.AgentExecutionMode;
export type AgentRun = local.AgentRun;
export type CampaignRow = local.CampaignRow;
export type CreativeConcept = local.CreativeConcept;

function mongoEnabled(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

/** Exposes the selected persistence mode without leaking a Mongo client into domain code. */
export function mongodbPersistenceConfigured(): boolean {
  return mongoEnabled();
}

function mongoRepositories() {
  return createMongoRepositories(WORKSPACE_ID);
}

export async function uploadFile(
  bucket: string,
  key: string,
  bytes: Buffer,
  mimeType = "application/octet-stream"
): Promise<StoredFile> {
  return mongoEnabled()
    ? gridfs.uploadFile(bucket, key, bytes, mimeType)
    : local.uploadFile(bucket, key, bytes, mimeType);
}

export async function downloadFile(bucket: string, key: string): Promise<Buffer | null> {
  return mongoEnabled() ? gridfs.downloadFile(bucket, key) : local.downloadFile(bucket, key);
}

export async function removeFile(bucket: string, key: string): Promise<void> {
  return mongoEnabled() ? gridfs.removeFile(bucket, key) : local.removeFile(bucket, key);
}

export async function startAgentRun(
  args: Parameters<typeof local.startAgentRun>[0]
): Promise<AgentRun> {
  if (!mongoEnabled()) return local.startAgentRun(args);
  return mongoRepositories().agentRuns.start(args);
}

export async function finishAgentRun(
  args: Parameters<typeof local.finishAgentRun>[0]
): Promise<void> {
  if (!mongoEnabled()) return local.finishAgentRun(args);
  return mongoRepositories().agentRuns.finish(args);
}

export async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  if (!mongoEnabled()) return local.getCampaign(campaignId);
  return mongoRepositories().campaigns.get(campaignId);
}

export async function listCampaigns(limit = 100): Promise<CampaignRow[]> {
  if (!mongoEnabled()) return local.listCampaigns(limit);
  return mongoRepositories().campaigns.list(limit);
}

export async function createCampaign(
  args: Parameters<typeof local.createCampaign>[0]
): Promise<CampaignRow> {
  if (!mongoEnabled()) return local.createCampaign(args);
  return mongoRepositories().campaigns.create(args);
}

export async function setCampaignResearch(
  campaignId: string,
  research: Record<string, unknown>
): Promise<CampaignRow> {
  if (!mongoEnabled()) return local.setCampaignResearch(campaignId, research);
  return mongoRepositories().campaigns.setResearch(campaignId, research);
}

export async function saveCreativeGeneration(
  args: Parameters<typeof local.saveCreativeGeneration>[0]
): Promise<string[]> {
  if (!mongoEnabled()) return local.saveCreativeGeneration(args);
  return mongoRepositories().creatives.saveGeneration(args);
}

export async function recordApproval(
  args: Parameters<typeof local.recordApproval>[0]
) {
  if (!mongoEnabled()) return local.recordApproval(args);
  return mongoRepositories().approvals.record(args);
}

export async function recordProductAsset(args: {
  campaignId: string;
  stored: StoredFile;
}): Promise<void> {
  if (!mongoEnabled()) {
    return local.recordProductAsset({ campaignId: args.campaignId, stored: args.stored });
  }

  if (args.stored.bucket !== "product-assets") {
    throw new Error("product assets must use product-assets");
  }
  const campaign = await mongoRepositories().campaigns.get(args.campaignId);
  if (!campaign) throw new Error("campaign not found");
  const database = await mongoDatabase();
  const assets = database.collection<{
    id: string;
    bucket_name: string;
    object_key: string;
    campaign_id: string;
    workspace_id: string;
    creative_variant_id: null;
    asset_kind: "product_source";
    storage_url: string;
    sha256: string | null;
    mime_type: string;
    byte_size: number | null;
    created_at: string;
  }>("creative_assets");
  const filter = { bucket_name: args.stored.bucket, object_key: args.stored.key };
  const existing = await assets.findOne(filter);
  if (existing) {
    if (
      existing.workspace_id !== WORKSPACE_ID ||
      existing.campaign_id !== args.campaignId ||
      existing.sha256 !== args.stored.sha256 ||
      existing.mime_type !== args.stored.mimeType ||
      existing.byte_size !== args.stored.byteSize
    ) {
      throw new Error("product asset key already belongs to different content");
    }
    return;
  }
  try {
    await assets.insertOne({
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
      created_at: new Date().toISOString(),
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await assets.findOne(filter);
    if (
      !raced ||
      raced.workspace_id !== WORKSPACE_ID ||
      raced.campaign_id !== args.campaignId ||
      raced.sha256 !== args.stored.sha256 ||
      raced.mime_type !== args.stored.mimeType ||
      raced.byte_size !== args.stored.byteSize
    ) {
      throw new Error("product asset key already belongs to different content");
    }
  }
}

export async function recordAgentMessage(
  args: Parameters<typeof local.recordAgentMessage>[0]
): Promise<void> {
  if (!mongoEnabled()) return local.recordAgentMessage(args);
  const database = await mongoDatabase();
  const [campaign, run] = await Promise.all([
    database.collection("campaigns").findOne({ id: args.campaignId, workspace_id: WORKSPACE_ID }),
    database.collection("agent_runs").findOne({ id: args.agentRunId, campaign_id: args.campaignId }),
  ]);
  if (!campaign || !run) throw new Error("agent message campaign or run not found");
  await database.collection("agent_messages").insertOne({
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
    created_at: new Date().toISOString(),
  });
}
