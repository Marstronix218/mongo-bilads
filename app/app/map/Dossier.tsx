/**
 * Orangeboard dossier — the right-hand white console panel on /map.
 *
 * Four tabs driven by the cockpit: INVENTORY (permit metadata straight off
 * the GASP geojson — no network), VISIBILITY (/api/visibility, rendered as an
 * explicit COMPUTED vs MODELED split — the honesty split is a core product
 * claim, so the section headers say exactly that), ADVERTISERS
 * (/api/advertisers + per-row Enrich / Mockup / Pitch / +Queue actions), and
 * QUEUE (the "Orange Slice" outbound worklist with CSV export).
 *
 * Failure chain: every fetch lands in an Async<T> cell keyed by recordId (or
 * recordId:advertiser), so a 500 or network drop renders one line of inline
 * error text in that cell and nothing else — the panel never crashes, and the
 * server routes themselves already fall back deterministically, so in the
 * common case even a dead LLM still returns 200 with modeled data.
 */
"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Async,
  AdvertisersResponse,
  AdvertiserRow,
  BoardSel,
  CockpitMode,
  MockupResponse,
  PitchResponse,
  QueueItem,
  VisibilityResponse,
} from "./types";
import { MONO_LABEL, ORANGE, INACTIVE, pct, postJson } from "./types";

// ─── Micro building blocks ──────────────────────────────────────────────────

function Label({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ ...MONO_LABEL, color: color ?? "#a3a3a3" }}>{children}</span>
  );
}

function SectionHeader({ title, tag }: { title: string; tag?: string }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-2">
      <span style={{ ...MONO_LABEL, color: "#404040", fontWeight: 700 }}>{title}</span>
      {tag && (
        <span
          style={{ ...MONO_LABEL, fontSize: "7.5px", color: ORANGE, border: `1px solid ${ORANGE}55` }}
          className="px-1 py-[1px] rounded-sm"
        >
          {tag}
        </span>
      )}
      <div className="flex-1" style={{ height: 1, background: "rgba(0,0,0,0.08)" }} />
    </div>
  );
}

function Bar({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  const p = pct(value);
  return (
    <div className="mb-2">
      <div className="flex justify-between mb-[3px]">
        <Label>{label}</Label>
        <Label color="#404040">
          {p}
          {suffix ?? "%"}
        </Label>
      </div>
      <div className="h-[3px] w-full" style={{ background: "rgba(0,0,0,0.07)" }}>
        <div className="h-full" style={{ width: `${p}%`, background: ORANGE }} />
      </div>
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <p style={{ ...MONO_LABEL, color: ORANGE }} className="animate-pulse py-3">
      {text}
    </p>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <p style={{ ...MONO_LABEL, color: "#b91c1c" }} className="py-2">
      {text}
    </p>
  );
}

function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-[5px]" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
      <Label>{k}</Label>
      <span className="text-right text-[11px] text-neutral-700 font-mono break-all">{v ?? "—"}</span>
    </div>
  );
}

function fmtDist(m: number): string {
  if (!Number.isFinite(m)) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`;
}

// ─── Tab: INVENTORY ─────────────────────────────────────────────────────────

function InventoryTab({ board, hasBiz }: { board: BoardSel; hasBiz: boolean | null }) {
  return (
    <div>
      <SectionHeader title="Permit record" tag="CITY DATA" />
      <KV k="Address" v={board.address} />
      <KV k="Record ID" v={board.recordId} />
      <KV
        k="Status"
        v={
          <span style={{ color: board.recordStatus === "Permitted" ? ORANGE : undefined }}>
            {board.recordStatus}
            {board.recordStatusDate ? ` · ${board.recordStatusDate}` : ""}
          </span>
        }
      />
      <KV k="Opened" v={board.dateOpened ?? "—"} />
      <KV k="Closed" v={board.dateClosed ?? "open"} />
      <KV k="Planner" v={board.plannerName ?? "—"} />
      <KV k="Planner email" v={board.plannerEmail ?? "—"} />
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        {board.acalink && (
          <a
            href={board.acalink}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...MONO_LABEL, color: ORANGE, border: `1px solid ${ORANGE}66` }}
            className="px-2 py-1.5 hover:bg-yellow-50 transition-colors"
          >
            Open city permit ↗
          </a>
        )}
        <span
          style={{
            ...MONO_LABEL,
            color: hasBiz === null ? "#a3a3a3" : hasBiz ? "#166534" : "#a3a3a3",
            border: "1px solid rgba(0,0,0,0.12)",
          }}
          className="px-2 py-1.5"
        >
          {hasBiz === null
            ? "Business data: scan via advertisers"
            : hasBiz
              ? "● Business data attached"
              : "○ No business data"}
        </span>
      </div>
    </div>
  );
}

// ─── Tab: VISIBILITY ────────────────────────────────────────────────────────

function VisibilityTab({ state }: { state: Async<VisibilityResponse> | undefined }) {
  if (!state || state.status === "loading")
    return <Spinner text="Scoring visibility — traffic grid + occlusion model…" />;
  if (state.status === "error")
    return <ErrorLine text={`Visibility unavailable (${state.error}) — retry by reselecting the sign.`} />;
  const v = state.data;
  const tod = v.modeled.timeOfDayFit;
  return (
    <div>
      <div className="flex items-end gap-2 mt-2">
        <span className="text-5xl font-bold text-neutral-800 font-mono leading-none">
          {pct(v.visibilityScore)}
        </span>
        <Label>/100 visibility</Label>
      </div>

      <SectionHeader title="Computed" tag="REAL SIGNALS" />
      <Bar label="Traffic exposure" value={v.computed.trafficExposure} />
      <KV k="Nearby businesses" v={String(v.computed.nearbyBusinessCount)} />
      <KV k="Heat points in range" v={String(v.computed.nearbyHeatPoints)} />
      <KV k="Intersection" v={v.computed.intersectionHint} />

      <SectionHeader title="Modeled" tag="PROJECTION" />
      <Bar label="Occlusion risk" value={v.modeled.occlusionRisk} />
      <KV k="Apparent size" v={v.modeled.apparentSize} />
      <KV k="Dwell estimate" v={`~${Math.round(v.modeled.dwellSeconds)}s`} />
      <div className="mt-3">
        <Label>Time-of-day fit</Label>
        <div className="grid grid-cols-4 gap-2 mt-1.5">
          {(
            [
              ["AM", tod.morning],
              ["MID", tod.midday],
              ["PM", tod.evening],
              ["NIGHT", tod.night],
            ] as const
          ).map(([k, val]) => (
            <div key={k}>
              <div className="h-8 flex items-end" style={{ background: "rgba(0,0,0,0.05)" }}>
                <div className="w-full" style={{ height: `${pct(val)}%`, background: ORANGE }} />
              </div>
              <div className="text-center mt-1">
                <Label>{k}</Label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {v.notes.length > 0 && (
        <>
          <SectionHeader title="Notes" />
          {v.notes.map((n, i) => (
            <p key={i} className="text-[11px] text-neutral-600 font-mono mb-1.5 leading-relaxed">
              · {n}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

// ─── Tab: ADVERTISERS ───────────────────────────────────────────────────────

function ActionBtn({
  label,
  onClick,
  busy,
  done,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  done?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || done}
      style={{
        ...MONO_LABEL,
        fontSize: "8px",
        color: done ? "#166534" : busy ? "#a3a3a3" : INACTIVE,
        border: "1px solid rgba(0,0,0,0.14)",
        cursor: busy || done ? "default" : "pointer",
      }}
      className="px-1.5 py-1 hover:border-yellow-400 hover:text-yellow-600 transition-colors disabled:hover:border-neutral-200"
    >
      {busy ? "…" : done ? "✓ " + label : label}
    </button>
  );
}

function MockupCard({ state }: { state: Async<MockupResponse> }) {
  if (state.status === "loading")
    return <Spinner text="Rendering board mockup (~20s, GMI image queue)…" />;
  if (state.status === "error")
    return <ErrorLine text={`Mockup failed (${state.error}).`} />;
  const m = state.data;
  return (
    <div className="mt-2 relative overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.12)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={m.imageUrl} alt={m.headline} className="w-full block" />
      <div
        className="absolute inset-x-0 bottom-0 p-2"
        style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.75))" }}
      >
        <p className="text-white font-bold text-sm leading-tight">{m.headline}</p>
        <p className="text-white/80 text-[10px] font-mono">{m.subline}</p>
      </div>
      <span
        style={{ ...MONO_LABEL, fontSize: "7px", color: "#fff", background: "rgba(0,0,0,0.55)" }}
        className="absolute top-1 right-1 px-1 py-[1px]"
      >
        {m.source}
      </span>
    </div>
  );
}

function PitchCard({ state }: { state: Async<PitchResponse> }) {
  const [copied, setCopied] = useState(false);
  if (state.status === "loading") return <Spinner text="Drafting outbound pitch…" />;
  if (state.status === "error") return <ErrorLine text={`Pitch failed (${state.error}).`} />;
  const p = state.data;
  const full = `Subject: ${p.subjectLine}\n\n${p.pitch}`;
  return (
    <div className="mt-2 p-2" style={{ background: "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.1)" }}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold text-neutral-800 font-mono">{p.subjectLine}</p>
        <button
          onClick={() => {
            navigator.clipboard
              ?.writeText(full)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => {});
          }}
          style={{ ...MONO_LABEL, fontSize: "8px", color: copied ? "#166534" : ORANGE }}
          className="shrink-0 hover:opacity-70"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[10.5px] text-neutral-600 font-mono whitespace-pre-wrap mt-1.5 leading-relaxed">
        {p.pitch}
      </p>
      <p style={{ ...MONO_LABEL, fontSize: "7px", color: "#a3a3a3" }} className="mt-1.5">
        source: {p.source}
      </p>
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export default function Dossier({
  mode,
  board,
  queue,
  onAddQueue,
  onRemoveQueue,
  onClose,
  onJumpToBoard,
}: {
  mode: CockpitMode;
  board: BoardSel | null;
  queue: QueueItem[];
  onAddQueue: (item: QueueItem) => void;
  onRemoveQueue: (index: number) => void;
  onClose: () => void;
  onJumpToBoard: (recordId: string) => void;
}) {
  // Per-record fetch caches; a record is fetched once per session per kind.
  const [visMap, setVisMap] = useState<Record<string, Async<VisibilityResponse>>>({});
  const [advMap, setAdvMap] = useState<Record<string, Async<AdvertisersResponse>>>({});
  const [enriching, setEnriching] = useState<string | null>(null);
  // Per (recordId:advertiser) action results.
  const [mockups, setMockups] = useState<Record<string, Async<MockupResponse>>>({});
  const [pitches, setPitches] = useState<Record<string, Async<PitchResponse>>>({});

  const recordId = board?.recordId ?? null;

  // Lazy-load per tab: an undefined cache entry renders as the spinner, so we
  // only setState from promise callbacks (never synchronously in the effect);
  // the in-flight ref dedupes re-renders while a fetch is airborne.
  const visInflight = useRef<Set<string>>(new Set());
  const advInflight = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (mode !== "VISIBILITY" || !recordId) return;
    if (visMap[recordId] || visInflight.current.has(recordId)) return;
    visInflight.current.add(recordId);
    postJson<VisibilityResponse>("/api/visibility", { recordId })
      .then((data) => setVisMap((m) => ({ ...m, [recordId]: { status: "done", data } })))
      .catch((e) =>
        setVisMap((m) => ({
          ...m,
          [recordId]: { status: "error", error: e instanceof Error ? e.message : "failed" },
        }))
      )
      .finally(() => visInflight.current.delete(recordId));
  }, [mode, recordId, visMap]);

  useEffect(() => {
    if (mode !== "ADVERTISERS" || !recordId) return;
    if (advMap[recordId] || advInflight.current.has(recordId)) return;
    advInflight.current.add(recordId);
    postJson<AdvertisersResponse>("/api/advertisers", { recordId, mode: "auto" })
      .then((data) => setAdvMap((m) => ({ ...m, [recordId]: { status: "done", data } })))
      .catch((e) =>
        setAdvMap((m) => ({
          ...m,
          [recordId]: { status: "error", error: e instanceof Error ? e.message : "failed" },
        }))
      )
      .finally(() => advInflight.current.delete(recordId));
  }, [mode, recordId, advMap]);

  const handleEnrich = useCallback(() => {
    if (!recordId || enriching) return;
    setEnriching(recordId);
    postJson<AdvertisersResponse>("/api/advertisers", { recordId, mode: "auto", enrich: true })
      .then((data) => setAdvMap((m) => ({ ...m, [recordId]: { status: "done", data } })))
      .catch(() => {}) // keep the un-enriched list on failure — never dead-end
      .finally(() => setEnriching(null));
  }, [recordId, enriching]);

  const handleMockup = useCallback(
    (adv: AdvertiserRow) => {
      if (!board) return;
      const key = `${board.recordId}:${adv.name}`;
      setMockups((m) => ({ ...m, [key]: { status: "loading" } }));
      postJson<MockupResponse>("/api/mockup", {
        recordId: board.recordId,
        advertiserName: adv.name,
        category: adv.category,
        address: board.address,
      })
        .then((data) => setMockups((m) => ({ ...m, [key]: { status: "done", data } })))
        .catch((e) =>
          setMockups((m) => ({
            ...m,
            [key]: { status: "error", error: e instanceof Error ? e.message : "failed" },
          }))
        );
    },
    [board]
  );

  const handlePitch = useCallback(
    (adv: AdvertiserRow) => {
      if (!board) return;
      const key = `${board.recordId}:${adv.name}`;
      const vis = visMap[board.recordId];
      const advs = advMap[board.recordId];
      const visibilitySummary =
        vis?.status === "done"
          ? `Visibility ${pct(vis.data.visibilityScore)}/100; traffic exposure ${pct(vis.data.computed.trafficExposure)}%; ~${Math.round(vis.data.modeled.dwellSeconds)}s dwell (modeled); ${vis.data.computed.intersectionHint}`
          : undefined;
      const clusterSummary =
        advs?.status === "done"
          ? advs.data.clusters
              .slice(0, 4)
              .map((c) => `${c.category}×${c.count}`)
              .join(", ")
          : undefined;
      setPitches((m) => ({ ...m, [key]: { status: "loading" } }));
      postJson<PitchResponse>("/api/pitch", {
        recordId: board.recordId,
        advertiserName: adv.name,
        category: adv.category,
        visibilitySummary,
        clusterSummary,
      })
        .then((data) => setPitches((m) => ({ ...m, [key]: { status: "done", data } })))
        .catch((e) =>
          setPitches((m) => ({
            ...m,
            [key]: { status: "error", error: e instanceof Error ? e.message : "failed" },
          }))
        );
    },
    [board, visMap, advMap]
  );

  const handleAddQueue = useCallback(
    (adv: AdvertiserRow) => {
      if (!board) return;
      const key = `${board.recordId}:${adv.name}`;
      const vis = visMap[board.recordId];
      const pitch = pitches[key];
      onAddQueue({
        recordId: board.recordId,
        address: board.address,
        advertiserName: adv.name,
        category: adv.category,
        fitScore: pct(adv.fitScore),
        visibilityScore: vis?.status === "done" ? pct(vis.data.visibilityScore) : undefined,
        pitchSubject: pitch?.status === "done" ? pitch.data.subjectLine : undefined,
      });
    },
    [board, visMap, pitches, onAddQueue]
  );

  const exportCsv = useCallback(() => {
    const esc = (v: string | number | undefined | null): string => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "record_id,address,advertiser,category,fit_score,visibility_score,pitch_subject";
    const rows = queue.map((q) =>
      [q.recordId, q.address, q.advertiserName, q.category, q.fitScore, q.visibilityScore, q.pitchSubject]
        .map(esc)
        .join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "voyagent-queue.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [queue]);

  // Business-data badge: unknown until an advertisers scan ran for this record.
  const advState = recordId ? advMap[recordId] : undefined;
  const hasBiz = advState?.status === "done" ? advState.data.totalNearby > 0 : null;

  const title =
    mode === "QUEUE" ? "Voyagent queue" : board ? board.address.toLowerCase() : "dossier";

  return (
    <div
      className="fixed top-4 right-4 z-20 flex flex-col w-[380px] max-w-[calc(100vw-2rem)]"
      style={{
        maxHeight: "calc(100vh - 9.5rem)",
        background: "rgba(255,255,255,0.94)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}
      >
        <div className="min-w-0">
          <Label color={ORANGE}>{mode}</Label>
          <p className="text-[12px] font-bold text-neutral-800 font-mono truncate capitalize">
            {title}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close dossier"
          className="text-neutral-400 hover:text-neutral-800 transition-colors text-sm font-mono px-1"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="overflow-y-auto px-4 pb-4 grow">
        {mode === "INVENTORY" && board && <InventoryTab board={board} hasBiz={hasBiz} />}

        {mode === "VISIBILITY" && board && <VisibilityTab state={visMap[board.recordId]} />}

        {mode === "ADVERTISERS" && board && (
          <AdvertisersTab
            state={advMap[board.recordId]}
            enriching={enriching === board.recordId}
            recordId={board.recordId}
            queue={queue}
            mockups={mockups}
            pitches={pitches}
            onEnrich={handleEnrich}
            onMockup={handleMockup}
            onPitch={handlePitch}
            onAddQueue={handleAddQueue}
          />
        )}

        {mode === "QUEUE" && (
          <QueueTab
            queue={queue}
            onRemove={onRemoveQueue}
            onExport={exportCsv}
            onJump={onJumpToBoard}
          />
        )}

        {mode !== "QUEUE" && !board && (
          <p style={{ ...MONO_LABEL, color: "#a3a3a3" }} className="py-6 text-center">
            Select a highlighted sign on the map to open its dossier.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Tab bodies that need the caches (kept below main for readability) ──────

function AdvertisersTab({
  state,
  enriching,
  recordId,
  queue,
  mockups,
  pitches,
  onEnrich,
  onMockup,
  onPitch,
  onAddQueue,
}: {
  state: Async<AdvertisersResponse> | undefined;
  enriching: boolean;
  recordId: string;
  queue: QueueItem[];
  mockups: Record<string, Async<MockupResponse>>;
  pitches: Record<string, Async<PitchResponse>>;
  onEnrich: () => void;
  onMockup: (adv: AdvertiserRow) => void;
  onPitch: (adv: AdvertiserRow) => void;
  onAddQueue: (adv: AdvertiserRow) => void;
}) {
  if (!state || state.status === "loading")
    return <Spinner text="Ranking best-fit advertisers near this sign…" />;
  if (state.status === "error")
    return <ErrorLine text={`Advertiser scan unavailable (${state.error}).`} />;
  const a = state.data;
  const anyEnriched = a.advertisers.some((x) => x.enrichment);
  return (
    <div>
      <div className="flex items-center justify-between mt-3">
        <Label>
          {a.totalNearby} businesses in range · mode {a.mode}
        </Label>
        <button
          onClick={onEnrich}
          disabled={enriching || anyEnriched}
          style={{ ...MONO_LABEL, fontSize: "8px", color: anyEnriched ? "#166534" : ORANGE }}
          className="hover:opacity-70 disabled:opacity-60"
        >
          {enriching ? "Enriching…" : anyEnriched ? "✓ Enriched" : "Enrich all"}
        </button>
      </div>

      {/* Cluster chips */}
      <div className="flex flex-wrap gap-1.5 mt-2 mb-1">
        {a.clusters.map((c) => (
          <span
            key={c.category}
            title={c.sample}
            style={{ ...MONO_LABEL, fontSize: "8px", color: "#525252", border: "1px solid rgba(0,0,0,0.12)" }}
            className="px-1.5 py-[3px]"
          >
            {c.category} × {c.count}
          </span>
        ))}
      </div>

      <SectionHeader title="Ranked fit" tag="MODELED" />
      {a.advertisers.map((adv) => {
        const key = `${recordId}:${adv.name}`;
        const inQueue = queue.some((q) => q.recordId === recordId && q.advertiserName === adv.name);
        const mockup = mockups[key];
        const pitch = pitches[key];
        return (
          <div key={adv.name} className="py-2.5" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[12px] font-bold text-neutral-800 truncate">{adv.name}</p>
              <Label>{fmtDist(adv.distanceM)}</Label>
            </div>
            <Label>{adv.category}</Label>
            <div className="mt-1.5">
              <Bar label="Fit" value={adv.fitScore} />
            </div>
            <p className="text-[10.5px] text-neutral-600 font-mono leading-relaxed">{adv.rationale}</p>

            {adv.enrichment && (
              <div className="mt-1.5 p-1.5" style={{ background: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.2)" }}>
                <Label color={ORANGE}>enrichment · modeled</Label>
                <p className="text-[10px] text-neutral-600 font-mono mt-0.5">
                  {adv.enrichment.industry} · {adv.enrichment.headcountBand}
                </p>
                {adv.enrichment.signals.length > 0 && (
                  <p className="text-[10px] text-neutral-500 font-mono mt-0.5">
                    {adv.enrichment.signals.join(" · ")}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-1.5 mt-2 flex-wrap">
              <ActionBtn
                label="Mockup"
                onClick={() => onMockup(adv)}
                busy={mockup?.status === "loading"}
                done={mockup?.status === "done"}
              />
              <ActionBtn
                label="Pitch"
                onClick={() => onPitch(adv)}
                busy={pitch?.status === "loading"}
                done={pitch?.status === "done"}
              />
              <ActionBtn label={inQueue ? "In queue" : "+ Queue"} onClick={() => onAddQueue(adv)} done={inQueue} />
            </div>

            {mockup && <MockupCard state={mockup} />}
            {pitch && <PitchCard state={pitch} />}
          </div>
        );
      })}
    </div>
  );
}

function QueueTab({
  queue,
  onRemove,
  onExport,
  onJump,
}: {
  queue: QueueItem[];
  onRemove: (index: number) => void;
  onExport: () => void;
  onJump: (recordId: string) => void;
}) {
  if (queue.length === 0)
    return (
      <p style={{ ...MONO_LABEL, color: "#a3a3a3" }} className="py-6 text-center">
        Queue is empty — add advertisers from a sign&apos;s dossier with [+ Queue].
      </p>
    );
  return (
    <div>
      <div className="flex items-center justify-between mt-3 mb-2">
        <Label>
          {queue.length} row{queue.length === 1 ? "" : "s"} · persisted locally
        </Label>
        <button
          onClick={onExport}
          style={{ ...MONO_LABEL, fontSize: "8px", color: ORANGE, border: `1px solid ${ORANGE}66` }}
          className="px-2 py-1 hover:bg-yellow-50 transition-colors"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[9.5px] text-neutral-700">
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(0,0,0,0.12)" }}>
              {["SIGN", "ADVERTISER", "FIT", "VIS", ""].map((h) => (
                <th key={h} className="text-left py-1.5 pr-2" style={{ ...MONO_LABEL, color: "#a3a3a3" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queue.map((q, i) => (
              <tr key={`${q.recordId}:${q.advertiserName}`} style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <td className="py-1.5 pr-2 align-top">
                  <button onClick={() => onJump(q.recordId)} className="text-left hover:text-yellow-600 transition-colors" title={q.address}>
                    {q.recordId}
                    <br />
                    <span className="text-neutral-400">{q.address.slice(0, 22)}</span>
                  </button>
                </td>
                <td className="py-1.5 pr-2 align-top">
                  {q.advertiserName}
                  <br />
                  <span className="text-neutral-400">{q.category}</span>
                  {q.pitchSubject && (
                    <>
                      <br />
                      <span style={{ color: ORANGE }} title={q.pitchSubject}>
                        ✉ {q.pitchSubject.slice(0, 26)}
                        {q.pitchSubject.length > 26 ? "…" : ""}
                      </span>
                    </>
                  )}
                </td>
                <td className="py-1.5 pr-2 align-top">{q.fitScore}</td>
                <td className="py-1.5 pr-2 align-top">{q.visibilityScore ?? "—"}</td>
                <td className="py-1.5 align-top text-right">
                  <button
                    onClick={() => onRemove(i)}
                    aria-label="Remove row"
                    className="text-neutral-300 hover:text-red-600 transition-colors"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
