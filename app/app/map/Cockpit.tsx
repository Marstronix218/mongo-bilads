/**
 * Orangeboard cockpit console — the trapezoidal control strip bottom-center
 * of the /map route. Pure presentational: mode switching, live readouts
 * (sign count, selected record, local clock, Open-Meteo weather), and the
 * escape hatch back to buyer-facing Bilads. All data arrives via props so a
 * failed weather fetch upstream just renders "—" here — nothing throws.
 */
"use client";

import Link from "next/link";
import type { CockpitMode } from "./types";
import { MONO_LABEL, ORANGE, INACTIVE } from "./types";

const MODES: CockpitMode[] = ["INVENTORY", "VISIBILITY", "ADVERTISERS", "QUEUE"];

function Readout({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-[2px] min-w-0">
      <span style={{ ...MONO_LABEL, color: "#a3a3a3" }}>{label}</span>
      <span
        style={{
          ...MONO_LABEL,
          fontSize: "10px",
          color: accent ? ORANGE : "#404040",
          fontWeight: 600,
        }}
        className="truncate max-w-[110px]"
      >
        {value}
      </span>
    </div>
  );
}

export default function Cockpit({
  mode,
  onMode,
  boardCount,
  selectedId,
  clock,
  weather,
  queueCount,
}: {
  mode: CockpitMode;
  onMode: (m: CockpitMode) => void;
  boardCount: number;
  selectedId: string | null;
  clock: string;
  weather: string;
  queueCount: number;
}) {
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 hidden sm:block"
      style={{ filter: "drop-shadow(0 8px 24px rgba(0,0,0,.35))" }}
    >
      <div
        style={{
          width: 580,
          height: 96,
          clipPath: "polygon(8% 0%, 92% 0%, 100% 100%, 0% 100%)",
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderTop: "1px solid rgba(0,0,0,0.08)",
        }}
        className="flex flex-col justify-between pt-2.5 pb-2 px-[58px]"
      >
        {/* Top row: live readouts */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            style={{ ...MONO_LABEL, color: INACTIVE }}
            className="hover:opacity-60 transition-opacity shrink-0"
          >
            ← Bilads
          </Link>
          <Readout label="Inventory" value={boardCount > 0 ? `${boardCount} signs` : "loading"} />
          <Readout label="Selected" value={selectedId ?? "no sign"} accent={!!selectedId} />
          <Readout label="Local" value={clock || "—"} />
          <Readout label="Wx SF" value={weather || "—"} />
        </div>

        {/* Hairline rule */}
        <div style={{ height: 1, background: "rgba(0,0,0,0.08)" }} className="mx-[-24px]" />

        {/* Bottom row: mode buttons */}
        <div className="flex items-center justify-between">
          {MODES.map((m) => {
            const disabled = (m === "VISIBILITY" || m === "ADVERTISERS") && !selectedId;
            const active = mode === m;
            return (
              <button
                key={m}
                disabled={disabled}
                onClick={() => onMode(m)}
                style={{
                  ...MONO_LABEL,
                  fontSize: "9px",
                  fontWeight: active ? 700 : 500,
                  color: disabled ? "#d4d4d4" : active ? ORANGE : INACTIVE,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
                className="flex items-center gap-1.5 py-1 transition-colors hover:opacity-80"
              >
                <span
                  className="inline-block w-1 h-1 rounded-full"
                  style={{ background: active ? ORANGE : "transparent" }}
                />
                {m}
                {m === "QUEUE" && queueCount > 0 && (
                  <span style={{ color: ORANGE }}>({queueCount})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
