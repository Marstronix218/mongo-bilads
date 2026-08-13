import { NextRequest, NextResponse } from "next/server";
import type { ResearchRequest, ResearchResponse } from "@/lib/types";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { loadBoards } from "@/lib/boards";
import { getCampaign } from "@/lib/campaigns";
import { adminDatabase, finishAgentRun, startAgentRun, WORKSPACE_SLUG } from "@/lib/insforge";
import { runResearcher, fallbackResearcher, type ResearcherBlock } from "@/lib/researcher";
import { runMediaBuyer } from "@/lib/mediaBuyer";
import { scoreBoards, cannedReason } from "@/lib/scoring";
import { buildMockResearchResponse } from "@/lib/mock";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req, { allowMachine: true });
  if (auth.response) return auth.response;

  let body: ResearchRequest;
  try {
    body = (await req.json()) as ResearchRequest;
    validate(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request body" }, { status: 400 });
  }

  let campaign;
  try {
    campaign = await getCampaign(body.campaignId);
  } catch {
    return NextResponse.json({ error: "Campaign access check failed" }, { status: 500 });
  }
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (!requestMatchesCampaign(body, campaign)) {
    return NextResponse.json({ error: "Request does not match the saved campaign" }, { status: 409 });
  }

  let run;
  try {
    run = await startAgentRun({
      campaignId: campaign.id,
      initiatedBySubject: auth.principal.subject,
      requestId: body.requestId,
      agent: "researcher+media-buyer",
      model: process.env.GMI_CHAT_MODEL,
      input: { productName: body.brief.productName, campaign: body.campaign },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent run could not start" }, { status: 503 });
  }

  try {
    let response: ResearchResponse;
    let executionMode: "live" | "fallback" | "cache" | "mixed" = "live";

    if (req.nextUrl.searchParams.get("mock") === "1") {
      response = buildMockResearchResponse();
      executionMode = "cache";
    } else {
      const boards = loadBoards();
      let researcher: ResearcherBlock;
      try {
        researcher = await runResearcher(body.brief);
      } catch {
        researcher = fallbackResearcher(body.brief);
        executionMode = "fallback";
      }

      let mediaBuyer: ResearchResponse["mediaBuyer"];
      try {
        mediaBuyer = await runMediaBuyer(boards, researcher, body.campaign);
      } catch {
        const { rankings, top3 } = scoreBoards(boards, researcher.audienceProfile.interests, body.campaign);
        const byId = new Map(boards.map((board) => [board.id, board]));
        for (const ranking of rankings) {
          ranking.reason = cannedReason(byId.get(ranking.id)!, researcher.audienceProfile.interests);
        }
        mediaBuyer = {
          rankings,
          top3,
          findings: [
            `Scored all ${rankings.length} boards on audience match and impressions per dollar.`,
            `Top pick: ${top3[0] ?? "none in budget"}.`,
            `${rankings.filter((ranking) => ranking.inBudget).length} of ${rankings.length} boards fit the weekly budget.`,
            "Rankings are deterministic — math decides, agents explain.",
          ],
        };
        executionMode = executionMode === "fallback" ? "fallback" : "mixed";
      }
      response = { researcher, mediaBuyer };
    }

    const persisted = await adminDatabase().rpc("set_campaign_research", {
      p_workspace_slug: WORKSPACE_SLUG,
      p_campaign_id: campaign.id,
      p_research_result: response,
    });
    if (persisted.error) throw new Error(`Research persistence failed: ${persisted.error.message}`);

    await finishAgentRun({
      run,
      status: "succeeded",
      executionMode,
      output: { top3: response.mediaBuyer.top3 },
    });
    return NextResponse.json(response);
  } catch (error) {
    await finishAgentRun({
      run,
      status: "failed",
      errorCode: "research_failed",
      errorDetail: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Research failed" }, { status: 500 });
  }
}

function validate(body: ResearchRequest): void {
  if (typeof body?.campaignId !== "string" || !body.campaignId) throw new Error("missing campaignId");
  if (typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 128) {
    throw new Error("requestId must be 1-128 characters");
  }
  if (!body.brief) throw new Error("missing brief");
  const { productName, description, audience } = body.brief;
  if (typeof productName !== "string" || !productName.trim()) throw new Error("missing brief.productName");
  if (typeof description !== "string") throw new Error("missing brief.description");
  if (typeof audience !== "string") throw new Error("missing brief.audience");
  const campaign = body.campaign;
  if (!campaign || typeof campaign.weeklyBudgetUsd !== "number") throw new Error("missing campaign.weeklyBudgetUsd");
  if (typeof campaign.campaignWeeks !== "number") throw new Error("missing campaign.campaignWeeks");
  if (typeof campaign.awarenessWeight !== "number" || campaign.awarenessWeight < 0 || campaign.awarenessWeight > 1) {
    throw new Error("campaign.awarenessWeight must be in [0,1]");
  }
}

function requestMatchesCampaign(body: ResearchRequest, campaign: Awaited<ReturnType<typeof getCampaign>>): boolean {
  if (!campaign) return false;
  return campaign.product_name === body.brief.productName.trim()
    && campaign.product_description === body.brief.description
    && campaign.target_audience === body.brief.audience
    && Number(campaign.weekly_budget_usd) === body.campaign.weeklyBudgetUsd
    && Number(campaign.campaign_weeks) === body.campaign.campaignWeeks
    && Number(campaign.awareness_weight) === body.campaign.awarenessWeight;
}
