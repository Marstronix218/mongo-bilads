import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { getCampaign } from "@/lib/campaigns";
import { adminDatabase, finishAgentRun, startAgentRun, WORKSPACE_SLUG } from "@/lib/insforge";
import { startRoom, decideRoom, getRoom, type BandContext, type BandRoom } from "@/lib/band";

export const runtime = "nodejs";

interface BandPost {
  action: "start" | "approve" | "reject";
  requestId?: string;
  campaignId?: string;
  context?: BandContext;
  roomId?: string;
  note?: string;
}

const startRequests = new Map<string, Promise<BandRoom>>();

function startRoomOnce(requestId: string, context: BandContext, create: () => Promise<BandRoom>) {
  const key = `${context.campaignId}:${requestId}`;
  const existing = startRequests.get(key);
  if (existing) return existing;
  const created = create();
  startRequests.set(key, created);
  if (startRequests.size > 100) {
    const oldest = startRequests.keys().next().value as string | undefined;
    if (oldest && oldest !== key) startRequests.delete(oldest);
  }
  return created;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req);
  if (auth.response) return auth.response;

  const roomId = req.nextUrl.searchParams.get("roomId");
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!roomId || !campaignId) return NextResponse.json({ error: "roomId and campaignId are required" }, { status: 400 });
  const campaign = await getCampaign(campaignId);
  const room = getRoom(roomId);
  if (!campaign || !room || room.context.campaignId !== campaign.id) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  return NextResponse.json(room);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req);
  if (auth.response) return auth.response;
  const principal = auth.principal;

  let body: BandPost;
  try {
    body = (await req.json()) as BandPost;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
  const campaign = await getCampaign(body.campaignId);
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  if (body.action === "start") {
    if (!body.context?.brief?.productName || !body.requestId) {
      return NextResponse.json({ error: "requestId and context.brief.productName are required" }, { status: 400 });
    }
    if (body.requestId.length > 128) return NextResponse.json({ error: "requestId is too long" }, { status: 400 });
    if (body.context.campaignId !== campaign.id || body.context.brief.productName.trim() !== campaign.product_name) {
      return NextResponse.json({ error: "Context does not match the saved campaign" }, { status: 409 });
    }

    const context: BandContext = {
      ...body.context,
      campaignId: campaign.id,
      brief: {
        productName: body.context.brief.productName,
        description: body.context.brief.description,
        audience: body.context.brief.audience,
      },
    };

    try {
      const room = await startRoomOnce(body.requestId, context, async () => {
        const run = await startAgentRun({
          campaignId: campaign.id,
          initiatedBySubject: principal.subject,
          requestId: body.requestId!,
          agent: "band-collaboration",
          model: "BAND + deterministic specialist agents",
          input: { boardId: context.boardId ?? null, campaignWeeks: context.campaignWeeks ?? null },
        });
        try {
          const created = await startRoom(context, {
            campaignId: campaign.id,
            agentRunId: run.id,
          });
          await finishAgentRun({
            run,
            status: "succeeded",
            executionMode: created.integration.mode === "live" ? "live" : "fallback",
            output: { roomId: created.roomId, messageCount: created.messages.length },
          });
          return created;
        } catch (error) {
          await finishAgentRun({
            run,
            status: "failed",
            errorCode: "band_failed",
            errorDetail: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
          throw error;
        }
      });
      return NextResponse.json(room);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "BAND room failed" }, { status: 500 });
    }
  }

  if (body.action === "approve" || body.action === "reject") {
    if (!body.roomId || !body.requestId) {
      return NextResponse.json({ error: "roomId and requestId are required" }, { status: 400 });
    }
    const existing = getRoom(body.roomId);
    if (!existing || existing.context.campaignId !== campaign.id) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }
    const decision = body.action === "approve" ? "approved" : "rejected";
    const recorded = await adminDatabase().rpc("record_approval", {
      p_workspace_slug: WORKSPACE_SLUG,
      p_campaign_id: campaign.id,
      p_room_id: body.roomId,
      p_decision: decision,
      p_decided_by_subject: principal.subject,
      p_note: body.note ?? null,
      p_context: { boardId: existing.context.boardId ?? null },
      p_request_id: body.requestId,
    });
    if (recorded.error) return NextResponse.json({ error: recorded.error.message }, { status: 409 });

    const room = await decideRoom(body.roomId, decision, principal.subject, body.note);
    return NextResponse.json(room);
  }

  return NextResponse.json({ error: `unknown action: ${(body as { action?: string }).action}` }, { status: 400 });
}
