import "server-only";

import { randomUUID } from "node:crypto";
import type { Collection } from "mongodb";
import { mongoDatabase } from "@/lib/mongodb";
import { DEFAULT_WORKSPACE_ID } from "@/lib/platform/mongo/contracts";
import { fireworksEmbed, fireworksRerank } from "@/lib/platform/providers/fireworks";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  embedDocuments?(texts: string[]): Promise<number[][]>;
  embedQuery?(text: string): Promise<number[]>;
  rerank?(query: string, documents: string[], limit: number): Promise<Array<{ index: number; score: number }>>;
}

export interface KnowledgeChunk {
  id: string;
  workspace_id: string;
  campaign_id: string;
  kind: string;
  text: string;
  keywords: string[];
  metadata: Record<string, unknown>;
  embedding?: number[];
  created_at: string;
  updated_at: string;
}

export interface RetrievalResult extends Omit<KnowledgeChunk, "embedding"> {
  score: number;
  source: "semantic" | "keyword";
}

export interface RetrievalService {
  upsert(args: { id?: string; campaignId: string; kind: string; text: string; metadata?: Record<string, unknown> }): Promise<KnowledgeChunk>;
  search(args: { campaignId: string; query: string; kinds?: string[]; limit?: number }): Promise<RetrievalResult[]>;
}

const VECTOR_INDEX = process.env.MONGODB_VECTOR_INDEX?.trim() || "knowledge_embedding";
const semanticEnabled = () => process.env.SEMANTIC_RETRIEVAL_ENABLED?.trim().toLowerCase() === "true";
let indexPromise: Promise<string> | undefined;

function words(text: string): string[] {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])];
}

function fallbackScore(query: string[], chunk: KnowledgeChunk): number {
  if (!query.length) return 0;
  const haystack = new Set([...chunk.keywords, ...words(chunk.text)]);
  return query.reduce((score, word) => score + (haystack.has(word) ? 1 : 0), 0) / query.length;
}

export function createRetrievalService(
  embeddings?: EmbeddingProvider,
  workspaceId = DEFAULT_WORKSPACE_ID
): RetrievalService {
  async function chunks(): Promise<Collection<KnowledgeChunk>> {
    const result = (await mongoDatabase()).collection<KnowledgeChunk>("knowledge_chunks");
    indexPromise ??= Promise.all([
      result.createIndex(
        { workspace_id: 1, id: 1 },
        { name: "knowledge_id_unique", unique: true }
      ),
      result.createIndex(
        { workspace_id: 1, campaign_id: 1, kind: 1, updated_at: -1 },
        { name: "knowledge_campaign_kind" }
      ),
    ]).then(() => "ready").catch((error) => {
      indexPromise = undefined;
      throw error;
    });
    await indexPromise;
    return result;
  }

  return {
    async upsert(args) {
      const timestamp = new Date().toISOString();
      const id = args.id ?? randomUUID();
      let embedding: number[] | undefined;
      if (semanticEnabled() && embeddings) {
        try {
          embedding = embeddings.embedDocuments
            ? (await embeddings.embedDocuments([args.text]))[0]
            : (await embeddings.embed([args.text]))[0];
        } catch { /* keyword fallback remains usable */ }
      }
      const row: KnowledgeChunk = {
        id, workspace_id: workspaceId, campaign_id: args.campaignId, kind: args.kind,
        text: args.text, keywords: words(args.text), metadata: args.metadata ?? {},
        ...(embedding?.length ? { embedding } : {}), created_at: timestamp, updated_at: timestamp,
      };
      const mutableRow: Partial<KnowledgeChunk> = { ...row };
      delete mutableRow.created_at;
      await (await chunks()).updateOne(
        { id, workspace_id: workspaceId },
        { $set: mutableRow, $setOnInsert: { created_at: timestamp } },
        { upsert: true }
      );
      return row;
    },

    async search(args) {
      const limit = Math.max(1, Math.min(args.limit ?? 5, 25));
      const collection = await chunks();
      if (semanticEnabled() && embeddings) {
        try {
          const vector = embeddings.embedQuery
            ? await embeddings.embedQuery(args.query)
            : (await embeddings.embed([args.query]))[0];
          if (vector?.length) {
            const semanticLimit = Math.max(30, limit);
            const semantic = await collection.aggregate<KnowledgeChunk & { score: number }>([
              { $vectorSearch: { index: VECTOR_INDEX, path: "embedding", queryVector: vector, numCandidates: Math.max(100, semanticLimit * 10), limit: semanticLimit, filter: { workspace_id: workspaceId, campaign_id: args.campaignId, ...(args.kinds?.length ? { kind: { $in: args.kinds } } : {}) } } },
              { $set: { score: { $meta: "vectorSearchScore" } } },
              { $project: { embedding: 0 } },
            ]).toArray();
            if (semantic.length) {
              if (embeddings.rerank && semantic.length >= 10) {
                try {
                  const ranked = await embeddings.rerank(args.query, semantic.map((item) => item.text), limit);
                  return ranked.map(({ index, score }) => ({
                    ...semantic[index],
                    score,
                    source: "semantic" as const,
                  })).filter((item) => Boolean(item.id));
                } catch {
                  // Vector similarity remains a safe semantic result if reranking is unavailable.
                }
              }
              return semantic.slice(0, limit).map((item) => ({ ...item, source: "semantic" as const }));
            }
          }
        } catch {
          // Atlas vector index is externally provisioned; absence or provider failure falls through safely.
        }
      }

      const queryWords = words(args.query);
      const candidates = await collection.find({
        workspace_id: workspaceId, campaign_id: args.campaignId,
        ...(args.kinds?.length ? { kind: { $in: args.kinds } } : {}),
      }).sort({ updated_at: -1 }).limit(250).toArray();
      return candidates
        .map((chunk) => {
          const item: Partial<KnowledgeChunk> = { ...chunk };
          delete item.embedding;
          return { ...item, score: fallbackScore(queryWords, chunk), source: "keyword" as const } as RetrievalResult;
        })
        .filter((item) => item.score > 0 || queryWords.length === 0)
        .sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit);
    },
  };
}

/** Fireworks is only called when SEMANTIC_RETRIEVAL_ENABLED=true; otherwise this stays deterministic. */
export function createFireworksRetrievalService(workspaceId = DEFAULT_WORKSPACE_ID): RetrievalService {
  const configuredDimensions = Number.parseInt(process.env.FIREWORKS_EMBEDDING_DIMENSIONS || "1024", 10);
  const dimensions = Number.isInteger(configuredDimensions) && configuredDimensions > 0
    ? configuredDimensions
    : 1024;
  const retrievalInstruction =
    "Retrieve approved billboard creative and campaign evidence relevant to this planning query";
  return createRetrievalService(
    {
      embed: async (texts) => (await fireworksEmbed(texts, { dimensions, normalize: true })).vectors,
      embedDocuments: async (texts) =>
        (await fireworksEmbed(texts, { dimensions, normalize: true })).vectors,
      embedQuery: async (query) =>
        (await fireworksEmbed(
          `Instruct: ${retrievalInstruction}\nQuery: ${query}`,
          { dimensions, normalize: true }
        )).vectors[0],
      rerank: async (query, documents, limit) =>
        (await fireworksRerank(query, documents, { topN: limit })).results.map((item) => ({
          index: item.index,
          score: item.relevanceScore,
        })),
    },
    workspaceId
  );
}
