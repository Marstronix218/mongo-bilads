import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { mongoDatabase, mongodbConfigured } from "@/lib/mongodb";
import { resumeApprovalGraph, startApprovalGraph } from "./langgraph";

export type CreativeApprovalStatus = "awaiting_approval" | "approved" | "rejected";

export interface CreativeApprovalState {
  threadId: string;
  campaignId: string;
  creative: Record<string, unknown>;
  status: CreativeApprovalStatus;
  graphStarted: boolean;
  graphResumed: boolean;
  graphResumeOwner?: string;
  graphResumeLeaseUntil?: string;
  decision?: { requestId: string; note: string | null; decidedBy: string; decidedAt: string };
  processedRequestIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeApprovalCallbacks {
  onStarted?(state: CreativeApprovalState): Promise<void>;
  onApproved?(state: CreativeApprovalState): Promise<void>;
  onRejected?(state: CreativeApprovalState): Promise<void>;
}

export interface CreativeApprovalStore {
  get(threadId: string): Promise<CreativeApprovalState | null>;
  create(state: CreativeApprovalState): Promise<{ state: CreativeApprovalState; created: boolean }>;
  compareAndSet(previousRevision: number, state: CreativeApprovalState): Promise<boolean>;
}

export class WorkflowConflictError extends Error {}
export class WorkflowNotFoundError extends Error {}

const clone = (state: CreativeApprovalState): CreativeApprovalState => structuredClone(state);

class MemoryCreativeApprovalStore implements CreativeApprovalStore {
  private readonly values = new Map<string, CreativeApprovalState>();

  async get(threadId: string): Promise<CreativeApprovalState | null> {
    const value = this.values.get(threadId);
    return value ? clone(value) : null;
  }

  async create(state: CreativeApprovalState): Promise<{ state: CreativeApprovalState; created: boolean }> {
    const existing = this.values.get(state.threadId);
    if (existing) return { state: clone(existing), created: false };
    this.values.set(state.threadId, clone(state));
    return { state: clone(state), created: true };
  }

  async compareAndSet(previousRevision: number, state: CreativeApprovalState): Promise<boolean> {
    const current = this.values.get(state.threadId);
    if (!current || current.revision !== previousRevision) return false;
    this.values.set(state.threadId, clone(state));
    return true;
  }
}

class MongoCreativeApprovalStore implements CreativeApprovalStore {
  private indexesReady?: Promise<unknown>;

  constructor(private readonly db: Db) {}

  private collection(): Collection<CreativeApprovalState> {
    return this.db.collection<CreativeApprovalState>("platform_workflow_checkpoints");
  }

  private ensureIndexes(): Promise<unknown> {
    return (this.indexesReady ??= this.collection().createIndex({ threadId: 1 }, { unique: true }));
  }

  async get(threadId: string): Promise<CreativeApprovalState | null> {
    await this.ensureIndexes();
    return this.collection().findOne({ threadId }, { projection: { _id: 0 } });
  }

  async create(state: CreativeApprovalState): Promise<{ state: CreativeApprovalState; created: boolean }> {
    await this.ensureIndexes();
    try {
      await this.collection().insertOne(state);
      return { state, created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      const existing = await this.get(state.threadId);
      if (!existing) throw error;
      return { state: existing, created: false };
    }
  }

  async compareAndSet(previousRevision: number, state: CreativeApprovalState): Promise<boolean> {
    await this.ensureIndexes();
    const result = await this.collection().replaceOne(
      { threadId: state.threadId, revision: previousRevision },
      state,
    );
    return result.modifiedCount === 1;
  }
}

const globalWorkflows = globalThis as typeof globalThis & {
  biladsCreativeApprovalMemory?: MemoryCreativeApprovalStore;
  biladsCreativeApprovalStarts?: Map<string, Promise<void>>;
  biladsCreativeApprovalResumes?: Map<string, Promise<CreativeApprovalState>>;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

async function startGraphOnce(state: CreativeApprovalState): Promise<void> {
  const starts = (globalWorkflows.biladsCreativeApprovalStarts ??= new Map());
  const active = starts.get(state.threadId);
  if (active) return active;
  const run = startApprovalGraph(state.threadId, {
    campaignId: state.campaignId,
    creative: state.creative,
  });
  starts.set(state.threadId, run);
  try {
    await run;
  } finally {
    if (starts.get(state.threadId) === run) starts.delete(state.threadId);
  }
}

export async function defaultCreativeApprovalStore(): Promise<CreativeApprovalStore> {
  if (mongodbConfigured()) return new MongoCreativeApprovalStore(await mongoDatabase());
  return (globalWorkflows.biladsCreativeApprovalMemory ??= new MemoryCreativeApprovalStore());
}

function derivedThreadId(campaignId: string, requestId: string): string {
  return `creative-${createHash("sha256").update(`${campaignId}\0${requestId}`).digest("hex").slice(0, 24)}`;
}

export class CreativeApprovalWorkflow {
  constructor(
    private readonly store: CreativeApprovalStore,
    private readonly callbacks: CreativeApprovalCallbacks = {},
  ) {}

  async start(input: {
    campaignId: string;
    requestId: string;
    threadId?: string;
    creative: Record<string, unknown>;
  }): Promise<CreativeApprovalState> {
    const now = new Date().toISOString();
    const threadId = input.threadId || derivedThreadId(input.campaignId, input.requestId);
    const state: CreativeApprovalState = {
      threadId,
      campaignId: input.campaignId,
      creative: structuredClone(input.creative),
      status: "awaiting_approval",
      graphStarted: false,
      graphResumed: false,
      processedRequestIds: [input.requestId],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const result = await this.store.create(state);
    const saved = result.state;
    if (saved.campaignId !== input.campaignId) {
      throw new WorkflowConflictError("threadId already belongs to another campaign");
    }
    if (!saved.processedRequestIds.includes(input.requestId)) {
      throw new WorkflowConflictError("threadId already exists with a different start request");
    }
    if (stableJson(saved.creative) !== stableJson(input.creative)) {
      throw new WorkflowConflictError("start request already belongs to different creative data");
    }
    if (!saved.graphStarted) {
      await startGraphOnce(saved);
      const started: CreativeApprovalState = {
        ...saved,
        graphStarted: true,
        revision: saved.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      if (await this.store.compareAndSet(saved.revision, started)) {
        await this.callbacks.onStarted?.(started);
        return started;
      }
      return this.status(saved.threadId, saved.campaignId);
    }
    return saved;
  }

  async status(threadId: string, campaignId: string): Promise<CreativeApprovalState> {
    const state = await this.store.get(threadId);
    if (!state || state.campaignId !== campaignId) throw new WorkflowNotFoundError("workflow not found");
    return state;
  }

  async decide(input: {
    threadId: string;
    campaignId: string;
    requestId: string;
    decision: "approved" | "rejected";
    note?: string;
    decidedBy: string;
  }): Promise<CreativeApprovalState> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.status(input.threadId, input.campaignId);
      if (current.processedRequestIds.includes(input.requestId)) {
        if (!current.decision || current.decision.requestId !== input.requestId) {
          throw new WorkflowConflictError("requestId was already used for another workflow action");
        }
        if (current.status !== input.decision) {
          throw new WorkflowConflictError("requestId was already used for a different decision");
        }
        if (
          current.decision.note !== (input.note?.trim() || null) ||
          current.decision.decidedBy !== input.decidedBy
        ) {
          throw new WorkflowConflictError("requestId was already used with different decision data");
        }
        if (!current.graphResumed) return this.resumeRecordedDecision(current);
        return current;
      }
      if (current.status !== "awaiting_approval") {
        throw new WorkflowConflictError(`workflow is already ${current.status}`);
      }

      const next: CreativeApprovalState = {
        ...current,
        status: input.decision,
        decision: {
          requestId: input.requestId,
          note: input.note?.trim() || null,
          decidedBy: input.decidedBy,
          decidedAt: new Date().toISOString(),
        },
        processedRequestIds: [...current.processedRequestIds, input.requestId],
        graphResumed: false,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      if (!(await this.store.compareAndSet(current.revision, next))) continue;
      return this.resumeRecordedDecision(next);
    }
    throw new WorkflowConflictError("workflow changed concurrently; retry with the same requestId");
  }

  private async resumeRecordedDecision(state: CreativeApprovalState): Promise<CreativeApprovalState> {
    const resumes = (globalWorkflows.biladsCreativeApprovalResumes ??= new Map());
    const active = resumes.get(state.threadId);
    if (active) return active;
    const run = this.claimAndResume(state);
    resumes.set(state.threadId, run);
    try {
      return await run;
    } finally {
      if (resumes.get(state.threadId) === run) resumes.delete(state.threadId);
    }
  }

  private async claimAndResume(initial: CreativeApprovalState): Promise<CreativeApprovalState> {
    const owner = randomUUID();
    let state = initial;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (state.graphResumed) return state;
      if (!state.decision) throw new WorkflowConflictError("workflow decision is incomplete");
      const leaseUntil = state.graphResumeLeaseUntil
        ? Date.parse(state.graphResumeLeaseUntil)
        : 0;
      if (state.graphResumeOwner && leaseUntil > Date.now()) {
        throw new WorkflowConflictError("workflow decision is resuming; retry the same requestId");
      }
      const claimed: CreativeApprovalState = {
        ...state,
        graphResumeOwner: owner,
        graphResumeLeaseUntil: new Date(Date.now() + 60_000).toISOString(),
        revision: state.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      if (await this.store.compareAndSet(state.revision, claimed)) {
        return this.performResume(claimed, owner);
      }
      state = await this.status(state.threadId, state.campaignId);
    }
    throw new WorkflowConflictError("workflow decision is resuming; retry the same requestId");
  }

  private async performResume(state: CreativeApprovalState, owner: string): Promise<CreativeApprovalState> {
    if (!state.decision || state.graphResumeOwner !== owner) {
      throw new WorkflowConflictError("workflow resume lease was lost");
    }
    try {
      await resumeApprovalGraph(state.threadId, {
        decision: state.status === "approved" ? "approved" : "rejected",
        requestId: state.decision.requestId,
        note: state.decision.note ?? undefined,
        decidedBy: state.decision.decidedBy,
      });
    } catch (error) {
      const released: CreativeApprovalState = {
        ...state,
        revision: state.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      delete released.graphResumeOwner;
      delete released.graphResumeLeaseUntil;
      await this.store.compareAndSet(state.revision, released).catch(() => false);
      throw error;
    }
    const resumed: CreativeApprovalState = {
      ...state,
      graphResumed: true,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    delete resumed.graphResumeOwner;
    delete resumed.graphResumeLeaseUntil;
    const persisted = await this.store.compareAndSet(state.revision, resumed);
    const saved = persisted ? resumed : await this.status(state.threadId, state.campaignId);
    if (persisted) {
      if (saved.status === "approved") await this.callbacks.onApproved?.(saved);
      else await this.callbacks.onRejected?.(saved);
    }
    return saved;
  }
}

export async function creativeApprovalWorkflow(
  callbacks: CreativeApprovalCallbacks = {},
): Promise<CreativeApprovalWorkflow> {
  return new CreativeApprovalWorkflow(await defaultCreativeApprovalStore(), callbacks);
}
