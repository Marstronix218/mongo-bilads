import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest } from "@/lib/apiAuth";
import { evaluateWithOpenRouter } from "@/lib/platform/providers/openrouter";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ModelLabBody {
  model?: string;
  providerOrder?: string[];
  system?: string;
  prompt?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeApiRequest(req, {
    allowBrowser: false,
    allowMachine: true,
  });
  if (auth.response) return auth.response;

  let body: ModelLabBody;
  try {
    body = (await req.json()) as ModelLabBody;
    if (typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 20_000) {
      throw new Error("prompt must be 1-20,000 characters");
    }
    if (body.system !== undefined && (typeof body.system !== "string" || body.system.length > 10_000)) {
      throw new Error("system must be at most 10,000 characters");
    }
    if (body.model !== undefined && (typeof body.model !== "string" || body.model.length > 200)) {
      throw new Error("model is invalid");
    }
    if (
      body.providerOrder !== undefined &&
      (!Array.isArray(body.providerOrder) ||
        body.providerOrder.length > 5 ||
        body.providerOrder.some((item) => typeof item !== "string" || item.length > 100))
    ) {
      throw new Error("providerOrder is invalid");
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid request" },
      { status: 400 }
    );
  }

  try {
    const result = await evaluateWithOpenRouter({
      model: body.model,
      providerOrder: body.providerOrder,
      temperature: 0,
      messages: [
        ...(body.system ? [{ role: "system" as const, content: body.system }] : []),
        { role: "user", content: body.prompt!.trim() },
      ],
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "model evaluation failed" },
      { status: 502 }
    );
  }
}
