import { NextRequest, NextResponse } from "next/server";
import { authorized, creativeApprovalWorkflow, requiredId, workflowResponse } from "../_shared";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const principal = await authorized(req);
  if (principal instanceof NextResponse) return principal;
  let body: { campaignId?: unknown; requestId?: unknown; threadId?: unknown; creative?: unknown };
  try {
    body = await req.json();
    const campaignId = requiredId(body.campaignId, "campaignId");
    const requestId = requiredId(body.requestId, "requestId");
    const threadId = body.threadId === undefined ? undefined : requiredId(body.threadId, "threadId");
    if (!body.creative || typeof body.creative !== "object" || Array.isArray(body.creative)) {
      throw new Error("creative must be an object");
    }
    if (JSON.stringify(body.creative).length > 100_000) throw new Error("creative is too large");
    return workflowResponse(async () => ({
      workflow: await (await creativeApprovalWorkflow()).start({
        campaignId,
        requestId,
        threadId,
        creative: body.creative as Record<string, unknown>,
      }),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}

