import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { mongoDatabase } from "@/lib/mongodb";
import {
  DEFAULT_WORKSPACE_ID,
  type AgentRun,
  type AgentRunRepository,
  type ApprovalRepository,
  type ApprovalRow,
  type CampaignRepository,
  type CampaignRow,
  type CreativeRepository,
  type CreativeVariantRow,
} from "./contracts";

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

const terminalStatuses = ["succeeded", "failed", "cancelled"] as const;
const terminal = new Set<string>(terminalStatuses);
let indexesPromise: Promise<void> | undefined;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

async function db(): Promise<Db> {
  const database = await mongoDatabase();
  indexesPromise ??= createIndexes(database).catch((error) => {
    indexesPromise = undefined;
    throw error;
  });
  await indexesPromise;
  return database;
}

async function createIndexes(database: Db): Promise<void> {
  await Promise.all([
    database.collection("campaigns").createIndex(
      { workspace_id: 1, client_request_id: 1 },
      { unique: true, name: "campaign_request_unique" }
    ),
    database.collection("campaigns").createIndex(
      { workspace_id: 1, updated_at: -1 },
      { name: "campaign_recent" }
    ),
    database.collection("agent_runs").createIndex(
      { workspace_id: 1, campaign_id: 1, request_id: 1, agent: 1 },
      { unique: true, name: "agent_run_request_unique" }
    ),
    database.collection("creative_variants").createIndex(
      { workspace_id: 1, campaign_id: 1, idempotency_key: 1, position: 1 },
      { unique: true, name: "creative_request_position_unique" }
    ),
    database.collection("creative_assets").createIndex(
      { bucket_name: 1, object_key: 1 },
      { unique: true, name: "creative_asset_key_unique" }
    ),
    database.collection("approvals").createIndex(
      { workspace_id: 1, campaign_id: 1, request_id: 1 },
      { unique: true, name: "approval_request_unique" }
    ),
  ]);
}

function collection<T extends object>(database: Db, name: string): Collection<T> {
  return database.collection<T>(name);
}

export function createMongoRepositories(workspaceId = DEFAULT_WORKSPACE_ID): {
  campaigns: CampaignRepository;
  agentRuns: AgentRunRepository;
  creatives: CreativeRepository;
  approvals: ApprovalRepository;
} {
  const campaigns: CampaignRepository = {
    async get(campaignId) {
      return collection<CampaignRow>(await db(), "campaigns").findOne({ id: campaignId, workspace_id: workspaceId });
    },

    async list(limit = 100) {
      return collection<CampaignRow>(await db(), "campaigns")
        .find({ workspace_id: workspaceId })
        .sort({ updated_at: -1 })
        .limit(Math.max(0, Math.min(limit, 500)))
        .toArray();
    },

    async create(args) {
      const campaignsCollection = collection<CampaignRow>(await db(), "campaigns");
      const sampleId = args.sampleId?.trim() || null;
      const productName = args.productName.trim();
      const filter = { workspace_id: workspaceId, client_request_id: args.clientRequestId };
      const existing = await campaignsCollection.findOne(filter);
      if (existing) {
        const matches = existing.product_name === productName &&
          existing.product_description === args.productDescription &&
          existing.target_audience === args.targetAudience &&
          existing.weekly_budget_usd === args.weeklyBudgetUsd &&
          existing.campaign_weeks === args.campaignWeeks &&
          existing.awareness_weight === args.awarenessWeight &&
          existing.sample_id === sampleId;
        if (!matches) throw new Error("clientRequestId already belongs to different campaign data");
        return existing;
      }

      const timestamp = new Date().toISOString();
      const row: CampaignRow = {
        id: randomUUID(), workspace_id: workspaceId, client_request_id: args.clientRequestId,
        sample_id: sampleId, product_name: productName, product_description: args.productDescription,
        target_audience: args.targetAudience, weekly_budget_usd: args.weeklyBudgetUsd,
        campaign_weeks: args.campaignWeeks, awareness_weight: args.awarenessWeight, status: "draft",
        research_result: null, opened_board_ids: [], created_at: timestamp, updated_at: timestamp,
      };
      try {
        await campaignsCollection.insertOne(row);
        return row;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const raced = await campaignsCollection.findOne(filter);
        if (!raced) throw error;
        return campaigns.create(args);
      }
    },

    async setResearch(campaignId, research) {
      const campaignsCollection = collection<CampaignRow>(await db(), "campaigns");
      const updated = await campaignsCollection.findOneAndUpdate(
        { id: campaignId, workspace_id: workspaceId, status: { $in: ["draft", "researched"] } },
        [{ $set: { research_result: research, status: { $cond: [{ $eq: ["$status", "draft"] }, "researched", "$status"] }, updated_at: new Date().toISOString() } }],
        { returnDocument: "after" }
      );
      if (updated) return updated;
      const campaign = await campaignsCollection.findOne({ id: campaignId, workspace_id: workspaceId });
      if (!campaign) throw new Error("campaign not found");
      throw new Error("research cannot be changed after creative work begins");
    },
  };

  const agentRuns: AgentRunRepository = {
    async start(args) {
      const runs = collection<AgentRun>(await db(), "agent_runs");
      const campaignId = args.campaignId ?? null;
      const filter = { workspace_id: workspaceId, campaign_id: campaignId, request_id: args.requestId, agent: args.agent };
      const existing = await runs.findOne(filter);
      if (existing) return existing;
      const timestamp = new Date().toISOString();
      const row: AgentRun = {
        id: randomUUID(), workspace_id: workspaceId, campaign_id: campaignId,
        initiated_by_subject: args.initiatedBySubject, request_id: args.requestId, agent: args.agent,
        model: args.model ?? null, input_hash: createHash("sha256").update(stableJson(args.input)).digest("hex"),
        input_summary: args.input, output_summary: null, execution_mode: args.executionMode ?? "live",
        status: "running", error_code: null, error_detail: null, started_at: timestamp, finished_at: null,
        duration_ms: null, created_at: timestamp,
      };
      try {
        await runs.insertOne(row);
        return row;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        const raced = await runs.findOne(filter);
        if (!raced) throw error;
        return raced;
      }
    },

    async finish(args) {
      if (terminal.has(args.run.status)) return;
      const finishedAt = new Date();
      const runs = collection<AgentRun>(await db(), "agent_runs");
      const row = await runs.findOne({ id: args.run.id, workspace_id: workspaceId });
      if (!row || terminal.has(row.status)) return;
      const startedAt = row.started_at ? new Date(row.started_at) : finishedAt;
      await runs.updateOne(
        { id: row.id, workspace_id: workspaceId, status: { $nin: terminalStatuses } },
        { $set: {
          status: args.status, output_summary: args.output ?? null,
          ...(args.executionMode ? { execution_mode: args.executionMode } : {}),
          error_code: args.status === "failed" ? args.errorCode ?? "agent_failed" : null,
          error_detail: args.status === "failed" ? (args.errorDetail ?? "Agent execution failed").slice(0, 2000) : null,
          finished_at: finishedAt.toISOString(), duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        } }
      );
    },
  };

  const creatives: CreativeRepository = {
    async saveGeneration(args) {
      if (args.concepts.length < 1 || args.concepts.length > 2) throw new Error("concepts must contain one or two items");
      const database = await db();
      const campaign = await collection<CampaignRow>(database, "campaigns").findOne({
        id: args.campaignId, workspace_id: workspaceId, status: { $in: ["researched", "designed"] },
      });
      if (!campaign) throw new Error("creative generation requires a researched, active campaign");
      const variants = collection<CreativeVariantRow>(database, "creative_variants");
      const assets = collection<CreativeAssetRow>(database, "creative_assets");
      const ids: string[] = [];
      for (const [expected, concept] of args.concepts.entries()) {
        if (concept.position !== expected) throw new Error("concept positions must be ordered from zero");
        const filter = { workspace_id: workspaceId, campaign_id: args.campaignId, idempotency_key: args.idempotencyKey, position: concept.position };
        let variant: CreativeVariantRow | null = await variants.findOne(filter);
        if (!variant) {
          variant = {
            id: randomUUID(), workspace_id: workspaceId, campaign_id: args.campaignId,
            idempotency_key: args.idempotencyKey, billboard_id: args.billboardId, generation: args.generation,
            position: concept.position, concept_key: concept.id, consistent_brand: args.consistentBrand,
            language: concept.language, headline: concept.headline, subline: concept.subline ?? "",
            rationale: concept.rationale ?? "", source: args.source, created_at: new Date().toISOString(),
          };
          try { await variants.insertOne(variant); }
          catch (error) {
            if ((error as { code?: number }).code !== 11000) throw error;
            variant = await variants.findOne(filter);
            if (!variant) throw error;
          }
        }
        if (!variant) throw new Error("creative variant could not be stored");
        if (
          variant.billboard_id !== args.billboardId ||
          variant.generation !== args.generation ||
          variant.consistent_brand !== args.consistentBrand ||
          variant.concept_key !== concept.id ||
          variant.language !== concept.language ||
          variant.headline !== concept.headline ||
          variant.subline !== (concept.subline ?? "") ||
          variant.rationale !== (concept.rationale ?? "") ||
          variant.source !== args.source
        ) {
          throw new Error("idempotency key already belongs to different creative data");
        }
        ids.push(variant.id);
        if (concept.asset?.key && concept.asset.bucket === "generated-creatives") {
          await assets.updateOne(
            { bucket_name: concept.asset.bucket, object_key: concept.asset.key },
            { $setOnInsert: {
              id: randomUUID(), workspace_id: workspaceId, campaign_id: args.campaignId,
              creative_variant_id: variant.id, asset_kind: "generated_art", bucket_name: concept.asset.bucket,
              object_key: concept.asset.key, storage_url: concept.asset.url,
              mime_type: concept.asset.mimeType || "image/png", byte_size: concept.asset.byteSize ?? null,
              sha256: concept.asset.sha256 ?? null, created_at: new Date().toISOString(),
            } },
            { upsert: true }
          );
        }
      }
      await collection<CampaignRow>(database, "campaigns").updateOne(
        { id: args.campaignId, workspace_id: workspaceId },
        { $set: { ...(campaign.status === "researched" ? { status: "designed" as const } : {}), updated_at: new Date().toISOString() } }
      );
      return ids;
    },
  };

  const approvals: ApprovalRepository = {
    async record(args) {
      const database = await db();
      const campaign = await collection<CampaignRow>(database, "campaigns").findOne({ id: args.campaignId, workspace_id: workspaceId });
      if (!campaign || !["researched", "designed", "simulated"].includes(campaign.status)) {
        throw new Error("approval requires a researched, active campaign");
      }
      const approvalsCollection = collection<ApprovalRow>(database, "approvals");
      const filter = { workspace_id: workspaceId, campaign_id: args.campaignId, request_id: args.requestId };
      const matches = (approval: ApprovalRow) =>
        approval.decision === args.decision &&
        approval.room_id === (args.roomId || null) &&
        approval.decided_by_subject === args.decidedBySubject &&
        approval.note === (args.note || null) &&
        stableJson(approval.context) === stableJson(args.context ?? {});
      let existing = await approvalsCollection.findOne(filter);
      if (existing) {
        if (!matches(existing)) {
          throw new Error("request_id already belongs to a different approval");
        }
        return existing;
      }
      const row: ApprovalRow = {
        id: randomUUID(), workspace_id: workspaceId, campaign_id: args.campaignId,
        room_id: args.roomId || null, decision: args.decision, decided_by_subject: args.decidedBySubject,
        note: args.note || null, context: args.context ?? {}, request_id: args.requestId,
        decided_at: new Date().toISOString(),
      };
      try { await approvalsCollection.insertOne(row); return row; }
      catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        existing = await approvalsCollection.findOne(filter);
        if (!existing) throw error;
        if (!matches(existing)) throw new Error("request_id already belongs to a different approval");
        return existing;
      }
    },
  };

  return { campaigns, agentRuns, creatives, approvals };
}
