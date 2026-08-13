/**
 * Minimal server-side client for Band's Agent REST API.
 *
 * Each specialist is a separately registered Band remote agent with its own
 * API key. The first agent creates the room, recruits the four sibling agents,
 * and every specialist publishes its own contribution to the shared room.
 */
import type { BandAgent, BandMessage } from "./band";

const DEFAULT_BASE_URL = "https://app.band.ai/api/v1/agent";
const REQUEST_TIMEOUT_MS = 8_000;

const BAND_AGENT_KEYS = [
  ["Market Research Agent", "BAND_MARKET_RESEARCH_API_KEY"],
  ["Media Planner Agent", "BAND_MEDIA_PLANNER_API_KEY"],
  ["Creative Director Agent", "BAND_CREATIVE_DIRECTOR_API_KEY"],
  ["Performance Analyst Agent", "BAND_PERFORMANCE_ANALYST_API_KEY"],
  ["Risk and Brand Agent", "BAND_RISK_BRAND_API_KEY"],
] as const satisfies ReadonlyArray<readonly [Exclude<BandAgent, "Human">, string]>;

interface BandAgentProfile {
  id: string;
  name: string;
  handle: string;
  owner_uuid: string;
}

interface BandAgentCredential {
  agent: Exclude<BandAgent, "Human">;
  apiKey: string;
  profile: BandAgentProfile;
}

interface BandEnvelope<T> {
  data: T;
}

interface CreatedChat {
  id: string;
}

interface CreatedEvent {
  id: string;
  message_type: string;
  success: boolean;
}

export interface BandLiveRoom {
  roomId: string;
  approvalEventId?: string;
}

export class BandConfigurationError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing Band credentials: ${missing.join(", ")}`);
    this.name = "BandConfigurationError";
    this.missing = missing;
  }
}

function baseUrl(): string {
  return (process.env.BAND_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function configuredKeys(): Array<{
  agent: Exclude<BandAgent, "Human">;
  envName: string;
  apiKey: string;
}> {
  const missing: string[] = [];
  const configured = BAND_AGENT_KEYS.map(([agent, envName]) => {
    const apiKey = process.env[envName]?.trim() ?? "";
    if (!apiKey) missing.push(envName);
    return { agent, envName, apiKey };
  });

  if (missing.length) throw new BandConfigurationError(missing);
  return configured;
}

async function bandRequest<T>(
  path: string,
  apiKey: string,
  init: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        ...init.headers,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      let requestId: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: { request_id?: string };
        };
        requestId = body.error?.request_id;
      } catch {
        // Keep external response bodies out of application errors.
      }
      throw new Error(
        `Band ${init.method ?? "GET"} ${path} failed (${response.status})${
          requestId ? `, request ${requestId}` : ""
        }`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Band ${init.method ?? "GET"} ${path} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadAgents(): Promise<BandAgentCredential[]> {
  const configured = configuredKeys();
  const agents = await Promise.all(
    configured.map(async ({ agent, apiKey }) => {
      const response = await bandRequest<BandEnvelope<BandAgentProfile>>(
        "/me",
        apiKey
      );
      return { agent, apiKey, profile: response.data };
    })
  );

  const uniqueIds = new Set(agents.map(({ profile }) => profile.id));
  if (uniqueIds.size !== agents.length) {
    throw new Error("Each Band specialist must use a different registered agent API key");
  }
  const ownerIds = new Set(agents.map(({ profile }) => profile.owner_uuid));
  if (ownerIds.size !== 1) {
    throw new Error("All five Band specialists must be sibling agents with the same owner");
  }

  return agents;
}

function messageEvent(message: BandMessage): {
  event: {
    content: string;
    message_type: "task" | "attention";
    metadata: Record<string, unknown>;
  };
} {
  const requestsApproval = message.action === "request_approval";
  return {
    event: {
      content: message.message,
      message_type: requestsApproval ? "attention" : "task",
      metadata: requestsApproval
        ? {
            kind: "review",
            blocking: true,
            role: message.role,
            local_action: message.action,
          }
        : {
            role: message.role,
            ...(message.action ? { local_action: message.action } : {}),
          },
    },
  };
}

/** Create a live Band room and publish the locally generated agent summaries. */
export async function publishBandRoom(
  productName: string,
  messages: BandMessage[]
): Promise<BandLiveRoom> {
  const agents = await loadAgents();
  const coordinator = agents[0];
  const safeProductName = productName.replace(/[\0\r\n]/g, " ").trim() || "Campaign";

  const created = await bandRequest<BandEnvelope<CreatedChat>>(
    "/chats",
    coordinator.apiKey,
    {
      method: "POST",
      body: JSON.stringify({
        chat: { title: `Bilads approval — ${safeProductName}`.slice(0, 120) },
      }),
    }
  );
  const roomId = created.data.id;

  await Promise.all(
    [
      coordinator.profile.owner_uuid,
      ...agents.slice(1).map(({ profile }) => profile.id),
    ].map((participantId) =>
      bandRequest(`/chats/${roomId}/participants`, coordinator.apiKey, {
        method: "POST",
        body: JSON.stringify({
          participant: { participant_id: participantId, role: "member" },
        }),
      })
    )
  );

  let approvalEventId: string | undefined;
  for (const message of messages) {
    if (message.agent === "Human") continue;
    const sender = agents.find(({ agent }) => agent === message.agent);
    if (!sender) continue;

    const event = await bandRequest<BandEnvelope<CreatedEvent>>(
      `/chats/${roomId}/events`,
      sender.apiKey,
      {
        method: "POST",
        body: JSON.stringify(messageEvent(message)),
      }
    );
    if (message.action === "request_approval") {
      approvalEventId = event.data.id;
    }
  }

  return { roomId, approvalEventId };
}

/** Mirror a Bilads human decision into Band as a resolution event. */
export async function publishBandDecision(
  room: BandLiveRoom,
  decision: "approved" | "rejected",
  decidedBy: string,
  note?: string
): Promise<void> {
  const riskKey = process.env.BAND_RISK_BRAND_API_KEY?.trim();
  if (!riskKey) throw new BandConfigurationError(["BAND_RISK_BRAND_API_KEY"]);

  await bandRequest(`/chats/${room.roomId}/events`, riskKey, {
    method: "POST",
    body: JSON.stringify({
      event: {
        content:
          note ??
          (decision === "approved"
            ? "Campaign owner approved the plan."
            : "Campaign owner rejected the plan for revision."),
        message_type: "attention",
        metadata: {
          kind: "review",
          blocking: false,
          decision,
          decided_by: decidedBy,
          ...(room.approvalEventId
            ? { resolves: room.approvalEventId, resolution: decision }
            : {}),
        },
      },
    }),
  });
}
