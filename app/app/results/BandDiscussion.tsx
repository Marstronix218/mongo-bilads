"use client";

import { useEffect, useState } from "react";
import type {
  Billboard,
  ProductBrief,
  ResearchResponse,
} from "@/lib/types";

interface BandMessage {
  agent: string;
  role: string;
  message: string;
  timestamp: string;
  action?: string;
}

interface BandRoom {
  roomId: string;
  status: "discussing" | "awaiting_approval" | "approved" | "rejected";
  messages: BandMessage[];
  integration: {
    mode: "live" | "fallback";
    remoteRoomId?: string;
    warning?: string;
  };
}

type MessageType = "finding" | "recommendation" | "warning" | "approval";

function messageStyle(message: BandMessage): {
  emoji: string;
  type: MessageType;
} {
  if (message.agent === "Human") return { emoji: "👤", type: "approval" };
  if (message.agent.includes("Research")) return { emoji: "🔍", type: "finding" };
  if (message.agent.includes("Media")) return { emoji: "📊", type: "recommendation" };
  if (message.agent.includes("Creative")) return { emoji: "🎨", type: "recommendation" };
  if (message.agent.includes("Performance")) return { emoji: "📈", type: "finding" };
  return { emoji: "🛡️", type: "warning" };
}

export default function BandDiscussion({
  campaignId,
  brief,
  research,
  topBoards,
  campaignWeeks,
  visible,
  onToggle,
}: {
  campaignId: string;
  brief: ProductBrief;
  research: ResearchResponse;
  topBoards: Billboard[];
  campaignWeeks: number;
  visible: boolean;
  onToggle: () => void;
}) {
  const [room, setRoom] = useState<BandRoom | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [requestId] = useState(() => crypto.randomUUID());
  const topBoardId = topBoards[0]?.id;
  const messageCount = room?.messages.length ?? 0;

  useEffect(() => {
    if (!visible || room) return;

    const controller = new AbortController();

    fetch("/api/band", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        requestId,
        campaignId,
        context: {
          campaignId,
          brief,
          researcher: research.researcher,
          mediaBuyer: research.mediaBuyer,
          boardId: topBoardId,
          campaignWeeks,
        },
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as BandRoom | { error?: string };
        if (!response.ok) {
          throw new Error("error" in body && body.error ? body.error : "BAND request failed");
        }
        setRoom(body as BandRoom);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof Error && requestError.name === "AbortError") return;
        setError(requestError instanceof Error ? requestError.message : "BAND request failed");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [
    visible,
    room,
    brief,
    research,
    topBoardId,
    campaignWeeks,
    campaignId,
    requestId,
    retryNonce,
  ]);

  useEffect(() => {
    if (!visible || messageCount === 0) return;
    const interval = setInterval(() => {
      setVisibleCount((current) => {
        if (current >= messageCount) {
          clearInterval(interval);
          return current;
        }
        return current + 1;
      });
    }, 600);
    return () => clearInterval(interval);
  }, [visible, messageCount]);

  async function decide(action: "approve" | "reject") {
    if (!room || deciding) return;
    setDeciding(action);
    setError(null);
    try {
      const response = await fetch("/api/band", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          roomId: room.roomId,
          campaignId,
          requestId: `${requestId}:decision`,
        }),
      });
      const body = (await response.json()) as BandRoom | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body && body.error ? body.error : "Decision failed");
      }
      const updated = body as BandRoom;
      setRoom(updated);
      setVisibleCount(updated.messages.length);
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : "Decision failed");
    } finally {
      setDeciding(null);
    }
  }

  if (!visible) {
    return (
      <button
        onClick={() => {
          setLoading(true);
          setError(null);
          setVisibleCount(0);
          onToggle();
        }}
        className="w-full text-left bg-bilads-surface/50 border border-bilads-fg/10 rounded-lg p-3 text-xs font-mono text-bilads-fg/40 hover:text-bilads-fg/60 hover:border-bilads-fg/20 transition-colors"
      >
        View agent discussion →
      </button>
    );
  }

  return (
    <div className="bg-bilads-surface/50 border border-bilads-fg/10 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bilads-fg/10">
        <span className="text-xs font-mono text-bilads-fg/50">
          BAND — Agent Collaboration Room
        </span>
        <button
          onClick={onToggle}
          className="text-xs text-bilads-fg/40 hover:text-bilads-fg"
          aria-label="Close BAND discussion"
        >
          &times;
        </button>
      </div>

      {loading && !room && (
        <div className="p-3 flex items-center gap-2 text-bilads-fg/40">
          <div className="w-1.5 h-1.5 bg-bilads-accent rounded-full animate-pulse" />
          <span className="text-[10px] font-mono">Creating BAND room...</span>
        </div>
      )}

      {error && !room && (
        <div className="p-3 text-xs text-red-300/80">
          <p>{error}</p>
          <button
            onClick={() => {
              setError(null);
              setLoading(true);
              setRetryNonce((value) => value + 1);
            }}
            className="mt-2 text-[10px] font-mono text-bilads-accent hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {room && (
        <>
          <div className="px-3 pt-2 flex items-center gap-2 text-[9px] font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                room.integration.mode === "live" ? "bg-green-400" : "bg-amber-400"
              }`}
            />
            <span className="text-bilads-fg/35">
              {room.integration.mode === "live" ? "LIVE BAND ROOM" : "LOCAL FALLBACK"}
            </span>
          </div>

          <div className="max-h-80 overflow-y-auto p-3 space-y-3">
            {room.messages.slice(0, visibleCount).map((message, index) => {
              const presentation = messageStyle(message);
              return (
                <div
                  key={`${message.timestamp}-${index}`}
                  className={`flex gap-2 animate-fade-in ${
                    presentation.type === "approval"
                      ? "bg-bilads-accent/5 rounded-lg p-2 -mx-1"
                      : ""
                  }`}
                >
                  <span className="text-sm flex-shrink-0">{presentation.emoji}</span>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`text-xs font-bold ${
                          presentation.type === "warning"
                            ? "text-orange-400"
                            : presentation.type === "approval"
                              ? "text-bilads-accent"
                              : "text-bilads-fg/80"
                        }`}
                      >
                        {message.agent}
                      </span>
                      <span className="text-[10px] text-bilads-fg/30 font-mono">
                        {message.role}
                      </span>
                    </div>
                    <p className="text-xs text-bilads-fg/60 mt-0.5 leading-relaxed">
                      {message.message}
                    </p>
                  </div>
                </div>
              );
            })}

            {visibleCount < room.messages.length && (
              <div className="flex items-center gap-2 text-bilads-fg/30">
                <div className="w-1.5 h-1.5 bg-bilads-accent rounded-full animate-pulse" />
                <span className="text-[10px] font-mono">Agents deliberating...</span>
              </div>
            )}

            {visibleCount >= room.messages.length && room.status === "awaiting_approval" && (
              <div className="pt-2 border-t border-bilads-fg/10 flex gap-2">
                <button
                  onClick={() => decide("approve")}
                  disabled={Boolean(deciding)}
                  className="flex-1 rounded bg-bilads-accent/15 px-2 py-1.5 text-[10px] font-mono text-bilads-accent hover:bg-bilads-accent/25 disabled:opacity-50"
                >
                  {deciding === "approve" ? "Approving..." : "Approve plan"}
                </button>
                <button
                  onClick={() => decide("reject")}
                  disabled={Boolean(deciding)}
                  className="flex-1 rounded bg-red-400/10 px-2 py-1.5 text-[10px] font-mono text-red-300 hover:bg-red-400/20 disabled:opacity-50"
                >
                  {deciding === "reject" ? "Rejecting..." : "Request revision"}
                </button>
              </div>
            )}

            {error && <p className="text-[10px] text-red-300/80">{error}</p>}
            {room.integration.warning && (
              <p className="text-[9px] leading-relaxed text-amber-300/60">
                {room.integration.warning}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
