import "server-only";

import type { CampaignRow } from "./persistence";

export { getCampaign, listCampaigns, type CampaignRow } from "./persistence";

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
