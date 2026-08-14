import { NextRequest, NextResponse } from "next/server";
import type { AdConcept, GenerateRequest, GenerateResponse } from "@/lib/types";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { getBoard } from "@/lib/boards";
import { getCampaign } from "@/lib/campaigns";
import { runCreativeDirector, fallbackConcepts, safeImagePrompt, type ConceptDraft } from "@/lib/creative";
import { generateCacheKey, readGenerateCache, writeGenerateCache } from "@/lib/cache";
import { generateAdImage, placeholderUrl, type GeneratedImageResult } from "@/lib/images";
import { finishAgentRun, saveCreativeGeneration, startAgentRun, type AgentExecutionMode } from "@/lib/persistence";
import { CHAT_MODEL, IMAGE_MODEL } from "@/lib/inference";
import { SAMPLES } from "@/lib/samples";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req, { allowMachine: true });
  if (auth.response) return auth.response;

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
    validate(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "invalid request body" }, { status: 400 });
  }

  const board = getBoard(body.billboardId);
  if (!board) return NextResponse.json({ error: `unknown billboardId: ${body.billboardId}` }, { status: 400 });

  let campaign;
  try {
    campaign = await getCampaign(body.campaignId);
  } catch {
    return NextResponse.json({ error: "Campaign access check failed" }, { status: 500 });
  }
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  if (campaign.status !== "researched" && campaign.status !== "designed") {
    return NextResponse.json({ error: "Campaign research must finish before generating creative" }, { status: 409 });
  }
  if (campaign.product_name !== body.brief.productName.trim()) {
    return NextResponse.json({ error: "Request does not match the saved campaign" }, { status: 409 });
  }

  let run;
  try {
    run = await startAgentRun({
      campaignId: campaign.id,
      initiatedBySubject: auth.principal.subject,
      requestId: body.requestId,
      agent: "creative-director",
      model: `${CHAT_MODEL} + ${IMAGE_MODEL}`,
      input: {
        billboardId: body.billboardId,
        generation: body.variant ?? 0,
        consistentBrand: body.consistentBrand,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Agent run could not start" }, { status: 503 });
  }

  try {
    const live = req.nextUrl.searchParams.get("live") === "1";
    const demo = req.nextUrl.searchParams.get("demo") === "1"
      && SAMPLES.some((sample) => sample.brief.productName === body.brief.productName.trim());
    const cacheKey = generateCacheKey({
      billboardId: body.billboardId,
      productName: body.brief.productName,
      variant: body.variant ?? 0,
      consistentBrand: body.consistentBrand,
    });
    const cached = readGenerateCache(cacheKey);

    let response: GenerateResponse;
    let path: AgentExecutionMode = "live";
    let copyPath: "live" | "canned" = "live";

    if (demo && cached) {
      response = cached;
      path = "cache";
    } else if (demo) {
      // Demo requests never wait on an external model. Reuse the committed
      // base artwork when an alternate cache entry is absent and refresh copy
      // from the deterministic creative fallback.
      const baseCacheKey = generateCacheKey({
        billboardId: body.billboardId,
        productName: body.brief.productName,
        variant: 0,
        consistentBrand: false,
      });
      const base = readGenerateCache(baseCacheKey);
      const drafts = fallbackConcepts({ productName: body.brief.productName, board });
      response = {
        concepts: drafts.map((draft, index) =>
          toConcept(draft, {
            imageUrl: base?.concepts[index]?.imageUrl ?? placeholderUrl(body.brief.productName),
          })
        ),
      };
      path = base ? "cache" : "fallback";
      copyPath = "canned";
    } else if (!live && cached) {
      response = cached;
      path = "cache";
    } else {
      let drafts: ConceptDraft[];
      try {
        drafts = await runCreativeDirector(body, board);
      } catch {
        drafts = fallbackConcepts({ productName: body.brief.productName, board });
        copyPath = "canned";
      }

      const generated = await Promise.all(
        drafts.map((draft, index) =>
          generateAdImage(
            safeImagePrompt(draft.imagePrompt, board),
            cacheKey,
            index,
            body.brief.productName,
            live,
            { workspaceId: campaign.workspace_id, campaignId: campaign.id }
          )
        )
      );
      const allImagesGenerated = generated.every((item) => !item.imageUrl.startsWith("/api/placeholder"));

      if (allImagesGenerated) {
        response = { concepts: drafts.map((draft, index) => toConcept(draft, generated[index])) };
        writeGenerateCache(cacheKey, response);
        path = copyPath === "live" ? "live" : "mixed";
      } else if (cached) {
        response = cached;
        path = "cache";
      } else {
        const fallbackDrafts = fallbackConcepts({ productName: body.brief.productName, board });
        response = {
          concepts: fallbackDrafts.map((draft) =>
            toConcept(draft, { imageUrl: placeholderUrl(body.brief.productName) })
          ),
        };
        path = "fallback";
      }
    }

    const concepts = response.concepts.map((concept, position) => ({ ...concept, position }));
    await saveCreativeGeneration({
      campaignId: campaign.id,
      idempotencyKey: body.requestId,
      billboardId: body.billboardId,
      generation: body.variant ?? 0,
      consistentBrand: body.consistentBrand,
      source: path === "mixed" ? "fallback" : path,
      concepts,
    });

    await finishAgentRun({
      run,
      status: "succeeded",
      executionMode: path,
      output: { concepts: response.concepts.map((concept) => concept.headline), copyPath },
    });
    return NextResponse.json(response);
  } catch (error) {
    await finishAgentRun({
      run,
      status: "failed",
      errorCode: "creative_failed",
      errorDetail: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Creative generation failed" }, { status: 500 });
  }
}

function toConcept(draft: ConceptDraft, generated: GeneratedImageResult): AdConcept {
  return {
    id: draft.id,
    language: draft.language,
    headline: draft.headline,
    subline: draft.subline,
    rationale: draft.rationale,
    imageUrl: generated.imageUrl,
    ...(generated.asset ? { asset: generated.asset } : {}),
  };
}

function validate(body: GenerateRequest): void {
  if (typeof body?.campaignId !== "string" || !body.campaignId) throw new Error("missing campaignId");
  if (typeof body.requestId !== "string" || !body.requestId || body.requestId.length > 128) {
    throw new Error("requestId must be 1-128 characters");
  }
  if (typeof body.billboardId !== "string" || !body.billboardId) throw new Error("missing billboardId");
  if (!body.brief?.productName) throw new Error("missing brief.productName");
  if (!body.audienceProfile || !Array.isArray(body.audienceProfile.interests)) {
    throw new Error("missing audienceProfile.interests");
  }
  if (typeof body.consistentBrand !== "boolean") throw new Error("missing consistentBrand");
  if (body.variant !== undefined && (!Number.isInteger(body.variant) || body.variant < 0)) {
    throw new Error("variant must be a non-negative integer");
  }
}
