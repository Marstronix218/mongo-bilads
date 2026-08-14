import { NextRequest, NextResponse } from "next/server";
import { authorized, creativeApprovalWorkflow, optionalNote, requiredId, workflowResponse } from "../_shared";

export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const principal = await authorized(req);
  if (principal instanceof NextResponse) return principal;
  try {
    const body = await req.json();
    const workflow = await creativeApprovalWorkflow();
    return workflowResponse(async () => ({
      workflow: await workflow.decide({
        threadId: requiredId(body.threadId, "threadId"),
        campaignId: requiredId(body.campaignId, "campaignId"),
        requestId: requiredId(body.requestId, "requestId"),
        decision: "rejected",
        note: optionalNote(body.note),
        decidedBy: principal.subject,
      }),
    }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}
