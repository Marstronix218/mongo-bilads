import "server-only";

import { createHash } from "node:crypto";
import { createAdminClient } from "@insforge/sdk";

/**
 * Narrow server-side repository over the InsForge project-admin SDK.
 * There are no user accounts: every write lands in the single seeded Bilads
 * workspace and callers are identified only by an unverified subject label.
 */

/** Fixed UUID of the seeded `bilads` workspace (migration 20260714001745). */
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

let adminClient: ReturnType<typeof createAdminClient> | null = null;

function adminConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.INSFORGE_BASE_URL?.trim();
  const apiKey = process.env.INSFORGE_API_KEY?.trim();
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

export function insforgeAdminConfigured(): boolean {
  return adminConfig() !== null;
}

function admin() {
  const config = adminConfig();
  if (!config) {
    throw new Error("InsForge admin access is not configured");
  }
  adminClient ??= createAdminClient(config);
  return adminClient;
}

/** Server-only database accessor for the repository modules (never route input). */
export function adminDatabase() {
  return admin().database;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

export async function uploadFile(
  bucket: string,
  key: string,
  bytes: Buffer,
  mimeType = "application/octet-stream"
): Promise<StoredFile | null> {
  if (!insforgeAdminConfigured()) return null;

  const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
  const { data, error } = await admin().storage.from(bucket).upload(key, blob);
  if (error) throw new Error(`InsForge storage upload failed: ${errorMessage(error)}`);
  if (!data?.url || !data.key) throw new Error("InsForge storage upload returned no URL or key");

  return {
    bucket,
    url: data.url,
    key: data.key,
    mimeType,
    byteSize: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function downloadFile(bucket: string, key: string): Promise<Buffer | null> {
  if (!insforgeAdminConfigured()) return null;
  const { data, error } = await admin().storage.from(bucket).download(key);
  if (error) throw new Error(`InsForge storage download failed: ${errorMessage(error)}`);
  return data ? Buffer.from(await data.arrayBuffer()) : null;
}

export async function removeFile(bucket: string, key: string): Promise<void> {
  if (!insforgeAdminConfigured()) return;
  const { error } = await admin().storage.from(bucket).remove(key);
  if (error) throw new Error(`InsForge storage delete failed: ${errorMessage(error)}`);
}

const RUN_COLUMNS = "id, workspace_id, campaign_id, status, started_at";

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
  const now = new Date().toISOString();
  const inputJson = stableJson(args.input);
  const row = {
    workspace_id: WORKSPACE_ID,
    campaign_id: args.campaignId ?? null,
    initiated_by_subject: args.initiatedBySubject,
    request_id: args.requestId,
    agent: args.agent,
    model: args.model ?? null,
    input_hash: createHash("sha256").update(inputJson).digest("hex"),
    input_summary: args.input,
    execution_mode: args.executionMode ?? "live",
    status: "running",
    started_at: now,
  };

  const { data, error } = await admin()
    .database.from("agent_runs")
    .insert([row])
    .select(RUN_COLUMNS)
    .single();

  if (!error && data) return data as AgentRun;

  const existing = args.campaignId
    ? await admin()
        .database.from("agent_runs")
        .select(RUN_COLUMNS)
        .eq("campaign_id", args.campaignId)
        .eq("request_id", args.requestId)
        .eq("agent", args.agent)
        .maybeSingle()
    : await admin()
        .database.from("agent_runs")
        .select(RUN_COLUMNS)
        .eq("workspace_id", WORKSPACE_ID)
        .is("campaign_id", null)
        .eq("request_id", args.requestId)
        .eq("agent", args.agent)
        .maybeSingle();
  if (!existing.error && existing.data) return existing.data as AgentRun;

  throw new Error(`InsForge agent run insert failed: ${errorMessage(error)}`);
}

export async function finishAgentRun(args: {
  run: AgentRun;
  status: "succeeded" | "failed" | "cancelled";
  output?: Record<string, unknown>;
  executionMode?: AgentExecutionMode;
  errorCode?: string;
  errorDetail?: string;
}): Promise<void> {
  if (["succeeded", "failed", "cancelled"].includes(args.run.status)) return;

  const finishedAt = new Date();
  const startedAt = args.run.started_at ? new Date(args.run.started_at) : finishedAt;
  const patch = {
    status: args.status,
    output_summary: args.output ?? null,
    execution_mode: args.executionMode,
    error_code: args.status === "failed" ? args.errorCode ?? "agent_failed" : null,
    error_detail: args.status === "failed" ? (args.errorDetail ?? "Agent execution failed").slice(0, 2000) : null,
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
  };
  const { error } = await admin().database.from("agent_runs").update(patch).eq("id", args.run.id);
  if (!error) return;

  const existing = await admin().database.from("agent_runs").select("status").eq("id", args.run.id).maybeSingle();
  if (!existing.error && existing.data && ["succeeded", "failed", "cancelled"].includes(String(existing.data.status))) {
    return;
  }
  throw new Error(`InsForge agent run update failed: ${errorMessage(error)}`);
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
  const { error } = await admin().database.from("agent_messages").insert([{
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
  }]);
  if (error) throw new Error(`InsForge agent message insert failed: ${errorMessage(error)}`);
}
