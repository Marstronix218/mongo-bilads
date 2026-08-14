import "server-only";

import { createHash } from "node:crypto";
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
};

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
    if (!saved.graphStarted) {
      await startApprovalGraph(saved.threadId, {
        campaignId: saved.campaignId,
        creative: saved.creative,
      });
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
    if (!state.decision) throw new WorkflowConflictError("workflow decision is incomplete");
    await resumeApprovalGraph(state.threadId, {
      decision: state.status === "approved" ? "approved" : "rejected",
      requestId: state.decision.requestId,
      note: state.decision.note ?? undefined,
      decidedBy: state.decision.decidedBy,
    });
    const resumed: CreativeApprovalState = {
      ...state,
      graphResumed: true,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const saved = (await this.store.compareAndSet(state.revision, resumed))
      ? resumed
      : await this.status(state.threadId, state.campaignId);
    if (saved.status === "approved") await this.callbacks.onApproved?.(saved);
    else await this.callbacks.onRejected?.(saved);
    return saved;
  }
}

export async function creativeApprovalWorkflow(
  callbacks: CreativeApprovalCallbacks = {},
): Promise<CreativeApprovalWorkflow> {
  return new CreativeApprovalWorkflow(await defaultCreativeApprovalStore(), callbacks);
}
