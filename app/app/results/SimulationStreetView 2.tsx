"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AdConcept, Billboard } from "@/lib/types";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

export default function SimulationStreetView({
  board,
  concept,
}: {
  board: Billboard;
  concept: AdConcept;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [board.lng, board.lat],
      zoom: 17,
      pitch: 68,
      bearing: board.trafficType === "vehicle" ? -22 : 18,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });

    const markerEl = document.createElement("div");
    markerEl.className = "bilads-sim-billboard";
    markerEl.innerHTML = `
      <div class="bilads-sim-billboard-face">
        <img src="${escapeAttr(concept.imageUrl)}" alt="" />
        <div class="bilads-sim-copy">
          <strong>${escapeHtml(concept.headline)}</strong>
          <span>${escapeHtml(concept.subline)}</span>
        </div>
      </div>
      <div class="bilads-sim-pole"></div>
    `;

    const marker = new maplibregl.Marker({
      element: markerEl,
      anchor: "bottom",
      pitchAlignment: "map",
      rotationAlignment: "map",
    })
      .setLngLat([board.lng, board.lat])
      .addTo(map);

    map.on("load", () => {
      try {
        const styleLayers = map.getStyle().layers ?? [];
        const firstSymbol = styleLayers.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: "sim-3d-buildings",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            minzoom: 13,
            paint: {
              "fill-extrusion-color": "#26262b",
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.78,
            },
          },
          firstSymbol
        );
      } catch {
        // The basemap still works without extrusion support.
      }

      map.addSource("selected-board", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [board.lng, board.lat] },
        },
      });
      map.addLayer({
        id: "selected-board-halo",
        type: "circle",
        source: "selected-board",
        paint: {
          "circle-radius": 18,
          "circle-color": "rgba(245,212,0,0.12)",
          "circle-stroke-color": "#f5d400",
          "circle-stroke-width": 2,
        },
      });
    });

    return () => {
      marker.remove();
      map.remove();
    };
  }, [board, concept]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-bilads-fg/10 bg-black">
      <div ref={containerRef} className="h-[360px] w-full" />
      <div className="pointer-events-none absolute left-4 top-4 rounded bg-black/70 px-3 py-2 backdrop-blur">
        <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-bilads-accent">
          3D street simulation
        </p>
        <p className="text-xs text-bilads-fg/60">
          {board.name} · {board.neighborhood}
        </p>
      </div>
      <style jsx global>{`
        .bilads-sim-billboard {
          width: 220px;
          height: 150px;
          transform: translateY(8px);
          transform-style: preserve-3d;
          pointer-events: none;
        }
        .bilads-sim-billboard-face {
          position: relative;
          width: 220px;
          height: 124px;
          overflow: hidden;
          border: 5px solid #111;
          border-radius: 4px;
          background: #181818;
          box-shadow: 0 14px 28px rgba(0, 0, 0, 0.55);
        }
        .bilads-sim-billboard-face img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .bilads-sim-copy {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 14px;
          text-align: center;
          color: white;
          background: linear-gradient(
            180deg,
            rgba(0, 0, 0, 0.08),
            rgba(0, 0, 0, 0.42)
          );
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9);
        }
        .bilads-sim-copy strong {
          display: block;
          max-width: 100%;
          font: 800 20px/1.04 var(--font-display), system-ui, sans-serif;
        }
        .bilads-sim-copy span {
          display: block;
          max-width: 100%;
          font: 600 10px/1.2 var(--font-display), system-ui, sans-serif;
          opacity: 0.86;
        }
        .bilads-sim-pole {
          width: 12px;
          height: 32px;
          margin: 0 auto;
          background: #1a1a1a;
          box-shadow: 0 10px 18px rgba(0, 0, 0, 0.45);
        }
      `}</style>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
