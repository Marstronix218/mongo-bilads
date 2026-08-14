import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { getCampaign } from "@/lib/campaigns";
import { downloadFile, uploadFile } from "@/lib/persistence";
import { createElevenLabsProvider } from "@/lib/platform/providers/elevenlabs";
import { creativeApprovalWorkflow } from "@/lib/platform/workflows/creativeApproval";

export const runtime = "nodejs";

const MAX_TRANSCRIPT_LENGTH = 4_000;
const AUDIO_BUCKET = "campaign-audio";

interface StructuredBriefing {
  approvalStatus: "approved";
  campaignId: string;
  threadId: string;
  placement: string;
  caveats?: string[];
}

interface AudioBody {
  transcript?: unknown;
  briefing?: unknown;
  voiceId?: unknown;
  modelId?: unknown;
}

function limitedString(value: unknown, name: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) {
    throw new Error(`${name} is invalid`);
  }
  return value.trim();
}

function creativeSummary(creative: Record<string, unknown>): string {
  const headline = typeof creative.headline === "string" ? creative.headline.trim() : "";
  const subline = typeof creative.subline === "string" ? creative.subline.trim() : "";
  const summary = [headline, subline].filter(Boolean).join(" ") || JSON.stringify(creative);
  return summary.slice(0, 1_000);
}

async function briefingTranscript(value: unknown): Promise<string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("briefing is invalid");
  const input = value as Partial<StructuredBriefing>;
  if (input.approvalStatus !== "approved") {
    throw new Error("briefing.approvalStatus must be approved");
  }
  const campaignId = limitedString(input.campaignId, "briefing.campaignId", 128);
  const threadId = limitedString(input.threadId, "briefing.threadId", 128);
  const placement = limitedString(input.placement, "briefing.placement", 500);
  if (input.caveats !== undefined && (!Array.isArray(input.caveats) || input.caveats.length > 8)) {
    throw new Error("briefing.caveats is invalid");
  }
  const caveats = (input.caveats ?? []).map((item, index) =>
    limitedString(item, `briefing.caveats[${index}]`, 300),
  );
  const [workflow, campaign] = await Promise.all([
    (await creativeApprovalWorkflow()).status(threadId, campaignId),
    getCampaign(campaignId),
  ]);
  if (workflow.status !== "approved") throw new Error("creative must be approved before audio synthesis");
  if (!campaign) throw new Error("campaign not found");
  const budget = `$${Number(campaign.weekly_budget_usd).toLocaleString("en-US")} per week for ${campaign.campaign_weeks} weeks`;
  return [
    `Campaign briefing for ${campaign.product_name}.`,
    `Approved placement: ${placement}.`,
    `Budget: ${budget}.`,
    `Selected creative: ${creativeSummary(workflow.creative)}.`,
    ...(caveats.length ? [`Important caveats: ${caveats.join("; ")}.`] : []),
  ].join(" ");
}

function cacheKey(transcript: string, voiceId?: string, modelId?: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({ transcript, voiceId: voiceId ?? null, modelId: modelId ?? null }))
    .digest("hex");
  return `briefings/${digest}.mp3`;
}

function audioResponse(audio: Buffer, contentType: string, transcript: string, cache: "hit" | "miss") {
  return new NextResponse(new Uint8Array(audio), {
    headers: {
      "content-type": contentType,
      "content-length": String(audio.byteLength),
      "cache-control": "private, max-age=31536000, immutable",
      "x-audio-cache": cache,
      "x-transcript-sha256": createHash("sha256").update(transcript).digest("hex"),
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req, { allowMachine: true });
  if (auth.response) return auth.response;

  let transcript: string;
  let voiceId: string | undefined;
  let modelId: string | undefined;
  try {
    const body = (await req.json()) as AudioBody;
    if (body.transcript !== undefined && body.briefing !== undefined) {
      throw new Error("provide transcript or briefing, not both");
    }
    if (body.transcript !== undefined && auth.principal.kind !== "machine") {
      throw new Error("raw transcript synthesis requires a machine bearer credential");
    }
    if ((body.voiceId !== undefined || body.modelId !== undefined) && auth.principal.kind !== "machine") {
      throw new Error("voice and model overrides require a machine bearer credential");
    }
    transcript = body.transcript !== undefined
      ? limitedString(body.transcript, "transcript", MAX_TRANSCRIPT_LENGTH)
      : await briefingTranscript(body.briefing);
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) throw new Error("transcript is too long");
    voiceId = body.voiceId === undefined ? undefined : limitedString(body.voiceId, "voiceId", 128);
    modelId = body.modelId === undefined ? undefined : limitedString(body.modelId, "modelId", 128);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }

  const key = cacheKey(transcript, voiceId, modelId);
  try {
    const cached = await downloadFile(AUDIO_BUCKET, key);
    if (cached) return audioResponse(cached, "audio/mpeg", transcript, "hit");
  } catch {
    // Audio generation remains available if the cache is unavailable.
  }

  try {
    const result = await createElevenLabsProvider().synthesize({ text: transcript, voiceId, modelId });
    await uploadFile(AUDIO_BUCKET, key, result.audio, result.contentType).catch(() => undefined);
    return audioResponse(result.audio, result.contentType, transcript, "miss");
  } catch (error) {
    return NextResponse.json({
      transcript,
      audio: null,
      fallback: true,
      reason: error instanceof Error ? error.message : "audio generation unavailable",
    });
  }
}
