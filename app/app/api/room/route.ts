import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { getCampaign } from "@/lib/campaigns";
import { finishAgentRun, recordApproval, startAgentRun } from "@/lib/localdb";
import { startRoom, decideRoom, getRoom, type RoomContext, type ReviewRoom } from "@/lib/room";

export const runtime = "nodejs";

interface RoomPost {
  action: "start" | "approve" | "reject";
  requestId?: string;
  campaignId?: string;
  context?: RoomContext;
  roomId?: string;
  note?: string;
}

const startRequests = new Map<string, Promise<ReviewRoom>>();

function startRoomOnce(requestId: string, context: RoomContext, create: () => Promise<ReviewRoom>) {
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

  let body: RoomPost;
  try {
    body = (await req.json()) as RoomPost;
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

    const context: RoomContext = {
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
          agent: "agent-room",
          model: "deterministic specialist agents",
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
            executionMode: "live",
            output: { roomId: created.roomId, messageCount: created.messages.length },
          });
          return created;
        } catch (error) {
          await finishAgentRun({
            run,
            status: "failed",
            errorCode: "room_failed",
            errorDetail: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
          throw error;
        }
      });
      return NextResponse.json(room);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Agent room failed" }, { status: 500 });
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
    try {
      await recordApproval({
        campaignId: campaign.id,
        roomId: body.roomId,
        decision,
        decidedBySubject: principal.subject,
        note: body.note ?? null,
        context: { boardId: existing.context.boardId ?? null },
        requestId: body.requestId,
      });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Approval failed" }, { status: 409 });
    }

    const room = await decideRoom(body.roomId, decision, principal.subject, body.note);
    return NextResponse.json(room);
  }

  return NextResponse.json({ error: `unknown action: ${(body as { action?: string }).action}` }, { status: 400 });
}
