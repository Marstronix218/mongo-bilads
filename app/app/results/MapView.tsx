"use client";

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Circle, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import type { Billboard, HeatmapPoint } from "@/lib/types";
import type { OpportunityBlob } from "@/lib/blobs";
import heatmapData from "@/lib/traffic-heatmap.json";
import "leaflet/dist/leaflet.css";

// Custom pin icon with rank number
function createPinIcon(rank: number, isSelected: boolean) {
  return L.divIcon({
    className: "custom-pin",
    html: `<div style="
      background: ${isSelected ? "#F5D400" : "#F5D400CC"};
      color: #0B0B0B;
      width: 32px;
      height: 32px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 14px;
      border: 2px solid ${isSelected ? "#fff" : "#0B0B0B"};
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    "><span style="transform: rotate(45deg)">${rank}</span></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

// Auto-fit map bounds to pins
function FitBounds({ boards }: { boards: Billboard[] }) {
  const map = useMap();
  useEffect(() => {
    if (boards.length === 0) return;
    const bounds = L.latLngBounds(
      boards.map((b) => [b.lat, b.lng] as [number, number])
    );
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
  }, [boards, map]);
  return null;
}

// Heatmap layer using leaflet.heat
function HeatmapLayer({ visible }: { visible: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!visible) return;

    // leaflet.heat is a side-effect import that adds L.heatLayer
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("leaflet.heat");

    const points = (heatmapData as HeatmapPoint[]).map(
      ([lat, lng, intensity]) => [lat, lng, intensity] as [number, number, number]
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heat = (L as any).heatLayer(points, {
      radius: 20,
      blur: 15,
      maxZoom: 15,
      max: 1.0,
      gradient: {
        0.2: "#1a1a2e",
        0.4: "#e94560",
        0.6: "#F5D400",
        0.8: "#F5D400",
        1.0: "#ffffff",
      },
    });

    heat.addTo(map);
    return () => {
      map.removeLayer(heat);
    };
  }, [visible, map]);

  return null;
}

export default function MapView({
  boards,
  selectedBoard,
  onSelectBoard,
  blobs = [],
}: {
  boards: Billboard[];
  rankings?: unknown;
  selectedBoard: string | null;
  onSelectBoard: (id: string | null) => void;
  blobs?: OpportunityBlob[];
}) {
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showBlobs, setShowBlobs] = useState(true);
  const mapKey = useMemo(
    () => boards.map((board) => `${board.id}:${board.lat.toFixed(5)}:${board.lng.toFixed(5)}`).join("|"),
    [boards]
  );
  const [mountedMapKey, setMountedMapKey] = useState<string | null>(null);

  useEffect(() => {
    setMountedMapKey(null);
    const frame = window.requestAnimationFrame(() => setMountedMapKey(mapKey));
    return () => window.cancelAnimationFrame(frame);
  }, [mapKey]);

  return (
    // z-0 opens a stacking context so Leaflet's internal panes (z-index
    // 400-700) can't paint over sibling overlays like the floating info card.
    <div className="w-full h-full relative z-0">
      {mountedMapKey ? (
        <MapContainer
          key={mountedMapKey}
          center={[37.775, -122.418]}
          zoom={13}
          className="w-full h-full"
          zoomControl={false}
          style={{ background: "#1a1a1a" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          <FitBounds boards={boards} />
          <HeatmapLayer visible={showHeatmap} />
          {/* Opportunity blobs — ICP-matched account clusters (Peel-style ABM) */}
          {showBlobs &&
            blobs.map((blob, i) => (
              <Circle
                key={`blob-${i}`}
                center={[blob.lat, blob.lng]}
                radius={blob.radiusM}
                pathOptions={{
                  color: "#F5D400",
                  weight: 1,
                  opacity: 0.5,
                  fillColor: "#F5D400",
                  fillOpacity: 0.12,
                  dashArray: "6 6",
                }}
              >
                <Tooltip direction="top" opacity={0.95}>
                  <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                    <strong>
                      {blob.count} target accounts — {blob.label}
                    </strong>
                    <br />
                    {blob.sampleNames.join(" · ")}
                  </div>
                </Tooltip>
              </Circle>
            ))}
          {boards.map((board, i) => {
            const rank = i + 1;
            return (
              <Marker
                key={board.id}
                position={[board.lat, board.lng]}
                icon={createPinIcon(rank, selectedBoard === board.id)}
                eventHandlers={{
                  click: () =>
                    onSelectBoard(
                      selectedBoard === board.id ? null : board.id
                    ),
                }}
              />
            );
          })}
        </MapContainer>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#1a1a1a]">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-bilads-fg/35">
            Loading map
          </p>
        </div>
      )}

      {/* Heatmap toggle */}
      <button
        onClick={() => setShowHeatmap((v) => !v)}
        className={`absolute bottom-4 left-4 z-[1000] px-3 py-2 rounded-lg text-xs font-mono transition-colors ${
          showHeatmap
            ? "bg-bilads-accent text-bilads-bg"
            : "bg-bilads-surface/90 text-bilads-fg/70 hover:text-bilads-fg"
        }`}
      >
        {showHeatmap ? "Hide traffic" : "Show traffic"}
      </button>

      {/* Opportunity blob toggle */}
      {blobs.length > 0 && (
        <button
          onClick={() => setShowBlobs((v) => !v)}
          className={`absolute bottom-4 left-32 z-[1000] px-3 py-2 rounded-lg text-xs font-mono transition-colors ${
            showBlobs
              ? "bg-bilads-accent text-bilads-bg"
              : "bg-bilads-surface/90 text-bilads-fg/70 hover:text-bilads-fg"
          }`}
        >
          {showBlobs ? "Hide ICP blobs" : "Show ICP blobs"}
        </button>
      )}
    </div>
  );
}
