/**
 * /api/kylon — AI workforce management (SPONSORS.md §4).
 *
 * Kylon manages the AI marketing WORKFORCE (who is assigned what, with what
 * company context); BAND manages collaborative DECISION-MAKING. Assignment 5
 * ("Request approval") hands off to a BAND room.
 *
 * GET                      → current workspace (assignments + company context)
 * POST { action: "start", companyContext? }   → fresh assignment pipeline
 * POST { action: "advance" }                  → complete current assignment,
 *                            start the next; the approval step spins up BAND
 * POST { action: "update", id, status }       → set one assignment's status
 */
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { finishAgentRun, startAgentRun } from "@/lib/insforge";
import { authorizeMachineRequest } from "@/lib/apiAuth";

export const runtime = "nodejs";

export type AssignmentStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface Assignment {
  id: string;
  title: string;
  assignedTo: string;
  status: AssignmentStatus;
  startedAt?: string;
  completedAt?: string;
  /** e.g. the BAND roomId for the approval step */
  handoff?: Record<string, string>;
}

export interface CompanyContext {
  brandGuidelines: string;
  personas: string[];
  approvedClaims: string[];
  prohibitedLanguage: string[];
  budgetRules: string;
}

interface Workspace {
  assignments: Assignment[];
  companyContext: CompanyContext;
  startedAt: string;
}

const DEFAULT_CONTEXT: CompanyContext = {
  brandGuidelines: "Confident, urban, concise. Bold minimal visuals, high contrast, copy readable in 3 seconds.",
  personas: ["car-light commuter 25-40", "neighborhood creative", "startup finance lead"],
  approvedClaims: ["long range", "app-unlock", "lightweight frame"],
  prohibitedLanguage: ["best", "#1", "guaranteed", "scientifically proven"],
  budgetRules: "Weekly OOH spend must stay within the campaign's weeklyBudgetUsd.",
};

// The six-assignment lifecycle (SPONSORS.md §4 / NORIAKI.md Phase 4).
const PIPELINE: Array<Pick<Assignment, "id" | "title" | "assignedTo">> = [
  { id: "kylon-1", title: "Research San Francisco campaign locations", assignedTo: "Research Agent" },
  { id: "kylon-2", title: "Produce three media plans", assignedTo: "Media Planner" },
  { id: "kylon-3", title: "Generate creative variants", assignedTo: "Creative Director" },
  { id: "kylon-4", title: "Prepare budget allocation", assignedTo: "Performance Analyst" },
  { id: "kylon-5", title: "Request approval", assignedTo: "BAND Collaboration Room" },
  { id: "kylon-6", title: "Create final campaign package", assignedTo: "Packaging" },
];

let workspace: Workspace | null = null;

function freshWorkspace(companyContext?: Partial<CompanyContext>): Workspace {
  const now = new Date().toISOString();
  return {
    startedAt: now,
    companyContext: { ...DEFAULT_CONTEXT, ...companyContext },
    assignments: PIPELINE.map((a, i) => ({
      ...a,
      status: i === 0 ? "in_progress" : "pending",
      ...(i === 0 ? { startedAt: now } : {}),
    })),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeMachineRequest(req);
  if (auth.response) return auth.response;
  if (!workspace) workspace = freshWorkspace();
  return NextResponse.json(workspace);
}

interface KylonPost {
  action: "start" | "advance" | "update";
  companyContext?: Partial<CompanyContext>;
  id?: string;
  status?: AssignmentStatus;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authorizeMachineRequest(req);
  if (auth.response) return auth.response;
  let body: KylonPost;
  try {
    body = (await req.json()) as KylonPost;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (body.action === "start") {
    workspace = freshWorkspace(body.companyContext);
    await auditKylon("start", { assignmentCount: workspace.assignments.length });
    return NextResponse.json(workspace);
  }

  if (!workspace) workspace = freshWorkspace();

  if (body.action === "advance") {
    const now = new Date().toISOString();
    const current = workspace.assignments.find((a) => a.status === "in_progress");
    if (current) {
      current.status = "completed";
      current.completedAt = now;
    }
    const next = workspace.assignments.find((a) => a.status === "pending");
    if (next) {
      next.status = "in_progress";
      next.startedAt = now;
      // The approval assignment hands off to a BAND room.
      if (next.id === "kylon-5") {
        next.handoff = { status: "awaiting human campaign owner in the Bilads BAND room" };
      }
    }
    await auditKylon("advance", { current: current?.id ?? null, next: next?.id ?? null });
    return NextResponse.json(workspace);
  }

  if (body.action === "update") {
    const a = workspace.assignments.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: `unknown assignment id: ${body.id}` }, { status: 404 });
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    a.status = body.status;
    if (body.status === "in_progress") a.startedAt = new Date().toISOString();
    if (body.status === "completed") a.completedAt = new Date().toISOString();
    await auditKylon("update", { assignmentId: a.id, status: a.status });
    return NextResponse.json(workspace);
  }

  return NextResponse.json({ error: `unknown action: ${(body as { action?: string }).action}` }, { status: 400 });
}

async function auditKylon(action: string, output: Record<string, unknown>): Promise<void> {
  const run = await startAgentRun({
    initiatedBySubject: "kylon",
    requestId: randomUUID(),
    agent: "kylon-workforce",
    model: "Kylon",
    input: { action },
  });
  await finishAgentRun({ run, status: "succeeded", output });
}
