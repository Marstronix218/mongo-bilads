import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { CampaignParams, ProductBrief } from "@/lib/types";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { campaignToApi, listCampaigns, type CampaignRow } from "@/lib/campaigns";
import { adminDatabase, removeFile, uploadFile, WORKSPACE_SLUG } from "@/lib/insforge";

export const runtime = "nodejs";

const PRODUCT_BUCKET = "product-assets";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CreateCampaignBody {
  clientRequestId: string;
  sampleId?: string;
  brief: ProductBrief;
  campaign: CampaignParams;
}

function oneRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

function validate(body: CreateCampaignBody): void {
  if (!UUID.test(body?.clientRequestId ?? "")) throw new Error("clientRequestId must be a UUID");
  if (!body.brief?.productName?.trim()) throw new Error("brief.productName is required");
  if (body.brief.productName.length > 160) throw new Error("brief.productName is too long");
  if (typeof body.brief.description !== "string" || body.brief.description.length > 12000) {
    throw new Error("brief.description is invalid");
  }
  if (typeof body.brief.audience !== "string" || body.brief.audience.length > 4000) {
    throw new Error("brief.audience is invalid");
  }
  const campaign = body.campaign;
  if (!Number.isFinite(campaign?.weeklyBudgetUsd) || campaign.weeklyBudgetUsd <= 0) {
    throw new Error("campaign.weeklyBudgetUsd must be positive");
  }
  if (!Number.isInteger(campaign.campaignWeeks) || campaign.campaignWeeks < 1 || campaign.campaignWeeks > 52) {
    throw new Error("campaign.campaignWeeks must be between 1 and 52");
  }
  if (!Number.isFinite(campaign.awarenessWeight) || campaign.awarenessWeight < 0 || campaign.awarenessWeight > 1) {
    throw new Error("campaign.awarenessWeight must be in [0,1]");
  }
}

function decodeImage(dataUrl: string): { bytes: Buffer; mimeType: string; extension: string } {
  const match = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error("brief.imageBase64 must be a PNG, JPEG, or WebP data URL");
  const bytes = Buffer.from(match[3], "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024) {
    throw new Error("product image must be between 1 byte and 10 MiB");
  }
  return { bytes, mimeType: match[1], extension: match[2] === "jpeg" ? "jpg" : match[2] };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req);
  if (auth.response) return auth.response;

  try {
    const campaigns = await listCampaigns();
    return NextResponse.json({ campaigns: campaigns.map(campaignToApi) });
  } catch {
    return NextResponse.json({ error: "Campaigns could not be loaded" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req);
  if (auth.response) return auth.response;

  let body: CreateCampaignBody;
  try {
    body = (await req.json()) as CreateCampaignBody;
    validate(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid request" }, { status: 400 });
  }

  const { data, error } = await adminDatabase().rpc("create_campaign", {
    p_workspace_slug: WORKSPACE_SLUG,
    p_client_request_id: body.clientRequestId,
    p_product_name: body.brief.productName,
    p_product_description: body.brief.description,
    p_target_audience: body.brief.audience,
    p_weekly_budget_usd: body.campaign.weeklyBudgetUsd,
    p_campaign_weeks: body.campaign.campaignWeeks,
    p_awareness_weight: body.campaign.awarenessWeight,
    p_sample_id: body.sampleId ?? null,
  });
  const campaign = oneRow<CampaignRow>(data);
  if (error || !campaign) {
    return NextResponse.json({ error: error?.message ?? "Campaign could not be created" }, { status: 409 });
  }

  if (body.brief.imageBase64?.startsWith("data:")) {
    let stored: Awaited<ReturnType<typeof uploadFile>> = null;
    try {
      const image = decodeImage(body.brief.imageBase64);
      const key = `${campaign.workspace_id}/${campaign.id}/product/${randomUUID()}.${image.extension}`;
      stored = await uploadFile(PRODUCT_BUCKET, key, image.bytes, image.mimeType);
      if (!stored) throw new Error("InsForge Storage is not configured");

      const recorded = await adminDatabase().rpc("record_product_asset", {
        p_workspace_slug: WORKSPACE_SLUG,
        p_campaign_id: campaign.id,
        p_bucket_name: stored.bucket,
        p_object_key: stored.key,
        p_storage_url: stored.url,
        p_mime_type: stored.mimeType,
        p_byte_size: stored.byteSize,
        p_sha256: stored.sha256,
      });
      if (recorded.error) throw new Error(recorded.error.message);
    } catch (uploadError) {
      if (stored) await removeFile(stored.bucket, stored.key).catch(() => undefined);
      return NextResponse.json({ error: uploadError instanceof Error ? uploadError.message : "Product image upload failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ campaign: campaignToApi(campaign) }, { status: 201 });
}
