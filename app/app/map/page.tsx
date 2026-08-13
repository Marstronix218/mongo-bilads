/**
 * /map — Voyagent seller cockpit entry point.
 *
 * MapLibre GL touches window/document at import time, so the whole cockpit
 * loads via dynamic(ssr:false) — same pattern as results/MapView. While the
 * chunk streams in we show a console-styled boot line so the route never
 * flashes blank.
 */
"use client";

import dynamic from "next/dynamic";

const VoyagentMap = dynamic(() => import("./OrangeboardMap"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-[#111] flex items-center justify-center">
      <p
        className="animate-pulse"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "10px",
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "#F5D400",
        }}
      >
        Voyagent · booting cockpit…
      </p>
    </div>
  ),
});

export default function MapPage() {
  return <VoyagentMap />;
}
