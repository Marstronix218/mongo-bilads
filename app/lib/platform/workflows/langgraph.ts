import "server-only";

import {
  Command,
  MemorySaver,
  entrypoint,
  interrupt,
} from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { mongoClient, mongodbConfigured } from "@/lib/mongodb";

export type ApprovalDecision = {
  decision: "approved" | "rejected";
  requestId: string;
  note?: string;
  decidedBy: string;
};

export interface ApprovalGraphInput {
  campaignId: string;
  creative: Record<string, unknown>;
}

let checkpointerPromise: Promise<MemorySaver | MongoDBSaver> | undefined;

async function checkpointer(): Promise<MemorySaver | MongoDBSaver> {
  if (!checkpointerPromise) {
    checkpointerPromise = (async () => {
      if (!mongodbConfigured()) return new MemorySaver();
      const saver = new MongoDBSaver({
        client: await mongoClient(),
        dbName: process.env.MONGODB_DB || "bilads",
        checkpointCollectionName: "langgraph_checkpoints",
        checkpointWritesCollectionName: "langgraph_checkpoint_writes",
        enableTimestamps: true,
      });
      const errors = await saver.setup();
      if (errors.length) throw new AggregateError(errors, "LangGraph checkpoint setup failed");
      return saver;
    })();
  }
  return checkpointerPromise;
}

/**
 * Compiles the approval interrupt used by the workflow API. Business state is
 * persisted separately; the checkpoint is only the durable pause/resume record.
 */
export async function compileCreativeApprovalGraph() {
  return entrypoint(
    { name: "bilads_creative_approval", checkpointer: await checkpointer() },
    async (input: ApprovalGraphInput) => {
      const decision = await interrupt<
        { campaignId: string; creative: Record<string, unknown> },
        ApprovalDecision
      >({ campaignId: input.campaignId, creative: input.creative });
      return { ...input, decision };
    }
  );
}

export async function startApprovalGraph(
  threadId: string,
  input: ApprovalGraphInput
): Promise<void> {
  const graph = await compileCreativeApprovalGraph();
  await graph.invoke(input, { configurable: { thread_id: threadId } });
}

export async function resumeApprovalGraph(
  threadId: string,
  decision: ApprovalDecision
): Promise<unknown> {
  const graph = await compileCreativeApprovalGraph();
  return graph.invoke(new Command({ resume: decision }), {
    configurable: { thread_id: threadId },
  });
}

export const LANGGRAPH_REQUIRED_PACKAGES = [
  "@langchain/core",
  "@langchain/langgraph",
  "@langchain/langgraph-checkpoint-mongodb",
] as const;
