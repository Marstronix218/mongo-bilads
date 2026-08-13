import "server-only";

import { adminDatabase, WORKSPACE_ID } from "./insforge";

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

export async function getCampaign(campaignId: string): Promise<CampaignRow | null> {
  const { data, error } = await adminDatabase()
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", WORKSPACE_ID)
    .maybeSingle();
  if (error) throw new Error(`Campaign lookup failed: ${error.message}`);
  return (data as CampaignRow | null) ?? null;
}

export async function listCampaigns(limit = 100): Promise<CampaignRow[]> {
  const { data, error } = await adminDatabase()
    .from("campaigns")
    .select("*")
    .eq("workspace_id", WORKSPACE_ID)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Campaign listing failed: ${error.message}`);
  return (data as CampaignRow[]) ?? [];
}

export function campaignToApi(row: CampaignRow) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sampleId: row.sample_id ?? undefined,
    brief: {
      productName: row.product_name,
      description: row.product_description,
      audience: row.target_audience,
    },
    campaign: {
      weeklyBudgetUsd: Number(row.weekly_budget_usd),
      campaignWeeks: Number(row.campaign_weeks),
      awarenessWeight: Number(row.awareness_weight),
    },
    status: row.status,
    research: row.research_result ?? undefined,
    openedBoardIds: row.opened_board_ids,
  };
}
