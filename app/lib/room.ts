/**
 * Agent review room — five specialist agents post structured reasoning into a
 * shared room; the human campaign owner must explicitly approve before
 * anything proceeds.
 *
 * Messages are generated deterministically from the real campaign data
 * (research output, rankings, concepts, location signals) so the discussion is
 * meaningful, fast, and works offline.
 */
import type { AdConcept, ResearchResponse } from "@/lib/types";
import type { ProductBrief } from "@/lib/types";
import { getBoard } from "./boards";
import { signalForBoard, loadLocationSignals } from "./signals";
import { recordAgentMessage } from "./persistence";

export type RoomAgent =
  | "Market Research Agent"
  | "Media Planner Agent"
  | "Creative Director Agent"
  | "Performance Analyst Agent"
  | "Risk and Brand Agent"
  | "Human";

export interface RoomMessage {
  agent: RoomAgent;
  role: string;
  message: string;
  timestamp: string;
  action?: string;
}

export type RoomStatus = "discussing" | "awaiting_approval" | "approved" | "rejected";

export interface ReviewRoom {
  roomId: string;
  status: RoomStatus;
  messages: RoomMessage[];
  context: RoomContext;
}

export interface RoomContext {
  campaignId: string;
  brief: ProductBrief;
  researcher?: ResearchResponse["researcher"];
  mediaBuyer?: ResearchResponse["mediaBuyer"];
  boardId?: string;
  concepts?: AdConcept[];
  campaignWeeks?: number;
}

export interface RoomPersistence {
  campaignId: string;
  agentRunId: string;
}

const rooms = new Map<string, ReviewRoom>();
const roomPersistence = new Map<string, RoomPersistence>();
let roomSeq = 0;

export function getRoom(roomId: string): ReviewRoom | undefined {
  return rooms.get(roomId);
}

export function listRooms(): ReviewRoom[] {
  return [...rooms.values()];
}

export async function startRoom(context: RoomContext, persistence: RoomPersistence): Promise<ReviewRoom> {
  const roomId = `room-${++roomSeq}-${Date.now().toString(36)}`;
  const messages: RoomMessage[] = [];
  const persistenceWrites: Promise<void>[] = [];
  const post = (agent: RoomAgent, role: string, message: string, action?: string) => {
    const msg: RoomMessage = {
      agent,
      role,
      message,
      timestamp: new Date().toISOString(),
      ...(action ? { action } : {}),
    };
    messages.push(msg);
    persistenceWrites.push(recordAgentMessage({
      campaignId: persistence.campaignId,
      agentRunId: persistence.agentRunId,
      roomId,
      senderKind: "agent",
      agentName: msg.agent,
      roleLabel: msg.role,
      body: msg.message,
      action: msg.action,
    }));
  };

  const { brief, mediaBuyer, boardId, concepts } = context;
  const board = boardId ? getBoard(boardId) : undefined;
  const topId = boardId ?? mediaBuyer?.top3[0];
  const topBoard = board ?? (topId ? getBoard(topId) : undefined);
  const topRank = mediaBuyer?.rankings.find((r) => r.id === topBoard?.id);

  // 1) Market Research Agent — location findings from the signal dataset.
  const signal = topBoard ? signalForBoard(topBoard.id) : null;
  const anySignal = [...loadLocationSignals().values()][0];
  post(
    "Market Research Agent",
    "location intelligence",
    signal
      ? `${topBoard!.name}: ${signal.signals.slice(0, 2).join("; ")}. Confidence ${Math.round(signal.confidence * 100)}% (${signal.derivedFrom}).`
      : anySignal
        ? `Market scan (${anySignal.location}): ${anySignal.signals.slice(0, 2).join("; ")}.`
        : `Audience for ${brief.productName} concentrates around daily-routine corridors.`
  );

  // 2) Media Planner Agent — channel selection reasoning.
  post(
    "Media Planner Agent",
    "channel selection",
    topBoard
      ? `Recommend ${topBoard.name} (${topBoard.neighborhood}): ${
          topRank ? `demoMatch ${Math.round(topRank.demoMatch * 100)}%, ` : ""
        }$${topBoard.weeklyCostUsd}/week, ~${topBoard.dailyImpressions.toLocaleString()} daily impressions. Ranking is deterministic — impressions per dollar weighted by audience fit.`
      : `Awaiting media-buyer rankings; static OOH remains the primary channel for ${brief.productName}.`
  );

  // 3) Creative Director Agent — concept rationale and constraints.
  post(
    "Creative Director Agent",
    "creative rationale",
    concepts?.length
      ? `Two concepts staged: "${concepts[0].headline}" (${concepts[0].language}) and "${concepts[1]?.headline}" (${concepts[1]?.language}). Copy is HTML overlay only — image models garble text. ${topBoard?.spanishFriendly ? "Spanish variant honors the neighborhood's bilingual daily life." : ""}`
      : `Constraint set: headline ≤7 words, drive-by legible, no text baked into imagery, only approved claims from the brief.`
  );

  // 4) Performance Analyst Agent — simulation estimates.
  if (topBoard) {
    const weeks = context.campaignWeeks ?? 4;
    const demoMatch = topRank?.demoMatch ?? 0.2; // nominal fit when unscored
    const cumImpressions = topBoard.dailyImpressions * 7 * weeks;
    const targetReach = Math.round(cumImpressions * 0.6 * demoMatch);
    const conversions = Math.max(1, Math.round(targetReach * 0.0005));
    post(
      "Performance Analyst Agent",
      "simulation",
      `${weeks}-week scenario on ${topBoard.name}: ~${cumImpressions.toLocaleString()} impressions, ~${targetReach.toLocaleString()} target-demo reach, ~${conversions} est. conversions at $${(topBoard.weeklyCostUsd * weeks).toLocaleString()} spend. Scenario simulation, not a prediction — assumptions exposed in the UI.`
    );
  } else {
    post(
      "Performance Analyst Agent",
      "simulation",
      "Simulation pending board selection; will model impressions, target reach, and CPA over the campaign window."
    );
  }

  // 5) Risk and Brand Agent — deterministic checks, flags rejected variants.
  const risks = riskChecks(context, topBoard?.trafficType);
  if (risks.length === 0) {
    post("Risk and Brand Agent", "risk review", "No unsupported claims, readability, or targeting issues found. Clear to request approval.", "clear");
  } else {
    for (const r of risks) post("Risk and Brand Agent", "risk review", r.message, r.action);
  }

  post(
    "Risk and Brand Agent",
    "governance",
    "Final campaign decisions require explicit human approval before proceeding.",
    "request_approval"
  );

  const room: ReviewRoom = {
    roomId,
    status: "awaiting_approval",
    messages,
    context,
  };
  rooms.set(roomId, room);
  roomPersistence.set(roomId, persistence);

  await Promise.all(persistenceWrites);

  return room;
}

export async function decideRoom(
  roomId: string,
  decision: "approved" | "rejected",
  // Unverified caller label such as "shared-web" — there are no user accounts.
  decidedBySubject: string,
  note?: string
): Promise<ReviewRoom | undefined> {
  const room = rooms.get(roomId);
  if (!room) return undefined;
  room.status = decision;
  const msg: RoomMessage = {
    agent: "Human",
    role: "campaign owner",
    message: note ?? (decision === "approved" ? "Approved. Proceed with this plan." : "Rejected. Revise and resubmit."),
    timestamp: new Date().toISOString(),
    action: decision,
  };
  room.messages.push(msg);
  const persistence = roomPersistence.get(roomId);
  if (persistence) {
    await recordAgentMessage({
      campaignId: persistence.campaignId,
      agentRunId: persistence.agentRunId,
      roomId,
      senderKind: "human",
      actorSubject: decidedBySubject,
      roleLabel: msg.role,
      body: msg.message,
      action: msg.action,
    });
  }

  return room;
}

/* --- Risk and Brand Agent checks (deterministic) ---------------------------- */

const CLAIM_WORDS =
  /\b(best|#1|number one|guaranteed?|cure|heals?|scientifically proven|doctor[- ]recommended|fastest|cheapest|\d+% (off|better|faster))\b/i;
const SENSITIVE_TARGETING =
  /\b(race|ethnicity|religion|religious|political|health condition|disability|sexual orientation)\b/i;

function riskChecks(
  ctx: RoomContext,
  trafficType?: string
): Array<{ message: string; action?: string }> {
  const out: Array<{ message: string; action?: string }> = [];

  for (const [i, c] of (ctx.concepts ?? []).entries()) {
    const copy = `${c.headline} ${c.subline}`;
    const claim = copy.match(CLAIM_WORDS);
    if (claim) {
      out.push({
        message: `Reject variant ${i + 1}: "${c.headline}" contains an unsupported claim ("${claim[0]}") not present in the approved brief.`,
        action: "reject_variant",
      });
    }
    const words = c.headline.trim().split(/\s+/).length;
    if (words > 7) {
      out.push({
        message: `Variant ${i + 1} headline runs ${words} words — unreadable at ${trafficType === "vehicle" ? "highway viewing distance (3-second read)" : "billboard viewing distance"}. Cut to 7 or fewer.`,
        action: "flag_readability",
      });
    }
  }

  const targeting = `${ctx.researcher?.audienceProfile.interests.join(" ") ?? ""} ${ctx.brief.audience}`;
  if (SENSITIVE_TARGETING.test(targeting)) {
    out.push({
      message: "Targeting references a protected or sensitive trait — restrict to interest and behavior attributes only.",
      action: "flag_targeting",
    });
  }

  return out;
}
