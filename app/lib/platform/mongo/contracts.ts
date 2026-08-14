import "server-only";

export const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

export type CampaignStatus = "draft" | "researched" | "designed" | "simulated" | "archived";
export type AgentExecutionMode = "live" | "fallback" | "cache" | "mixed";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ApprovalDecision = "approved" | "rejected" | "edited";

export interface StoredFile {
  /** GridFS ObjectId encoded as a hex string. Safe to put in an authenticated route. */
  id: string;
  bucket: string;
  url: string;
  key: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
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
  status: CampaignStatus;
  research_result: unknown | null;
  opened_board_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  workspace_id: string;
  campaign_id: string | null;
  initiated_by_subject: string;
  request_id: string;
  agent: string;
  model: string | null;
  input_hash: string;
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown> | null;
  execution_mode: AgentExecutionMode;
  status: AgentRunStatus;
  error_code: string | null;
  error_detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

export interface CreativeConcept {
  id: string;
  language: string;
  headline: string;
  subline?: string;
  rationale?: string;
  position: number;
  asset?: {
    id?: string;
    bucket: string;
    key: string;
    url: string;
    mimeType?: string;
    byteSize?: number;
    sha256?: string;
  };
}

export interface CreativeVariantRow {
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

export interface ApprovalRow {
  id: string;
  workspace_id: string;
  campaign_id: string;
  room_id: string | null;
  decision: ApprovalDecision;
  decided_by_subject: string;
  note: string | null;
  context: Record<string, unknown>;
  request_id: string;
  decided_at: string;
}

export interface CampaignRepository {
  get(campaignId: string): Promise<CampaignRow | null>;
  list(limit?: number): Promise<CampaignRow[]>;
  create(args: {
    clientRequestId: string;
    sampleId?: string | null;
    productName: string;
    productDescription: string;
    targetAudience: string;
    weeklyBudgetUsd: number;
    campaignWeeks: number;
    awarenessWeight: number;
  }): Promise<CampaignRow>;
  setResearch(campaignId: string, research: Record<string, unknown>): Promise<CampaignRow>;
}

export interface AgentRunRepository {
  start(args: {
    campaignId?: string;
    initiatedBySubject: string;
    requestId: string;
    agent: string;
    model?: string;
    input: Record<string, unknown>;
    executionMode?: AgentExecutionMode;
  }): Promise<AgentRun>;
  finish(args: {
    run: Pick<AgentRun, "id" | "status">;
    status: "succeeded" | "failed" | "cancelled";
    output?: Record<string, unknown>;
    executionMode?: AgentExecutionMode;
    errorCode?: string;
    errorDetail?: string;
  }): Promise<void>;
}

export interface CreativeRepository {
  saveGeneration(args: {
    campaignId: string;
    idempotencyKey: string;
    billboardId: string;
    generation: number;
    consistentBrand: boolean;
    source: string;
    concepts: CreativeConcept[];
  }): Promise<string[]>;
}

export interface ApprovalRepository {
  record(args: {
    campaignId: string;
    roomId?: string | null;
    decision: ApprovalDecision;
    decidedBySubject: string;
    note?: string | null;
    context?: Record<string, unknown>;
    requestId: string;
  }): Promise<ApprovalRow>;
}
