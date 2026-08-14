import { NextRequest, NextResponse } from "next/server";
import { authorizeApiRequest, type ApiPrincipal } from "@/lib/apiAuth";
import {
  creativeApprovalWorkflow as createWorkflow,
  type CreativeApprovalState,
  WorkflowConflictError,
  WorkflowNotFoundError,
} from "@/lib/platform/workflows/creativeApproval";
import { mongodbConfigured } from "@/lib/mongodb";
import { createFireworksRetrievalService } from "@/lib/platform/retrieval";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function requiredId(value: unknown, name: string): string {
  if (typeof value !== "string" || !ID.test(value)) throw new Error(`${name} is invalid`);
  return value;
}

export function optionalNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 2000) throw new Error("note is invalid");
  return value;
}

export async function authorized(req: NextRequest): Promise<ApiPrincipal | NextResponse> {
  const auth = await authorizeApiRequest(req, { allowMachine: true });
  return auth.response ?? auth.principal;
}

export async function workflowResponse(run: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await run());
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof WorkflowConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "workflow request failed" },
      { status: 500 },
    );
  }
}

async function rememberApprovedCreative(state: CreativeApprovalState): Promise<void> {
  if (!mongodbConfigured()) return;
  try {
    await createFireworksRetrievalService().upsert({
      id: `approved-creative-${state.threadId}`,
      campaignId: state.campaignId,
      kind: "approved_creative",
      text: JSON.stringify(state.creative),
      metadata: {
        threadId: state.threadId,
        decisionRequestId: state.decision?.requestId,
        approvedAt: state.decision?.decidedAt,
      },
    });
  } catch (error) {
    console.error("approved creative memory ingestion failed", error);
  }
}

export async function creativeApprovalWorkflow() {
  return createWorkflow({ onApproved: rememberApprovedCreative });
}
