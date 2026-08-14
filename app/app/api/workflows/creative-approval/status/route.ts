import { NextRequest, NextResponse } from "next/server";
import { authorized, creativeApprovalWorkflow, requiredId, workflowResponse } from "../_shared";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const principal = await authorized(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const threadId = requiredId(req.nextUrl.searchParams.get("threadId"), "threadId");
    const campaignId = requiredId(req.nextUrl.searchParams.get("campaignId"), "campaignId");
    return workflowResponse(async () => ({
      workflow: await (await creativeApprovalWorkflow()).status(threadId, campaignId),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}

