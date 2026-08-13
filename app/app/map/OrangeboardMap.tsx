/**
 * Voyagent /map — seller cockpit orchestrator.
 *
 * Owns the MapLibre map (dark OpenFreeMap style, 3D building extrusions, 559
 * GASP permit signs as accent dots) plus all cross-panel state: selected
 * board, cockpit mode, clock, Open-Meteo weather, and the Voyagent queue
 * (localStorage-persisted). Cockpit.tsx and Dossier.tsx are dumb children.
 *
 * Failure chain — the map never dead-ends:
 *  - 3D extrusions are wrapped in try/catch: if the style ships without an
 *    "openmaptiles" building source-layer we just render a flat dark map.
 *  - /sf-billboards.geojson fetch failure leaves the basemap up with a "0
 *    SIGNS" readout instead of throwing.
 *  - Open-Meteo failure renders "—" in the weather slot.
 *  - localStorage read is try/caught (Safari private mode etc.).
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { LayerSpecification, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Cockpit from "./Cockpit";
import Dossier from "./Dossier";
import type { BoardSel, CockpitMode, QueueItem } from "./types";
import { MONO_LABEL, ORANGE } from "./types";

const QUEUE_KEY = "orangeboard-queue";
const SF_CENTER: [number, number] = [-122.418, 37.775];

function fmtClock(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** WMO weather_code → one short cockpit word. */
function weatherWord(code: number): string {
  if (code === 0) return "CLEAR";
  if (code === 1 || code === 2) return "FAIR";
  if (code === 3) return "CLOUDY";
  if (code === 45 || code === 48) return "FOG";
  if (code >= 51 && code <= 57) return "DRIZZLE";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "RAIN";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "SNOW";
  if (code >= 95) return "STORM";
  return "SKY";
}

/** Pull the fields the dossier needs off a geojson feature's properties. */
function toBoard(props: Record<string, unknown>, lng: number, lat: number): BoardSel {
  const s = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  return {
    recordId: s(props.record_id) ?? "UNKNOWN",
    address: s(props.address) ?? "Unknown address",
    lat,
    lng,
    recordStatus: s(props.record_status) ?? "Unknown",
    recordStatusDate: s(props.record_status_date),
    dateOpened: s(props.date_opened),
    dateClosed: s(props.date_closed),
    plannerName: s(props.planner_name),
    plannerEmail: s(props.planner_email),
    acalink: s(props.acalink),
  };
}

export default function OrangeboardMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const boardsIndexRef = useRef<Map<string, BoardSel>>(new Map());

  const [boardCount, setBoardCount] = useState(0);
  const [selected, setSelected] = useState<BoardSel | null>(null);
  const [mode, setMode] = useState<CockpitMode>("INVENTORY");
  const [panelOpen, setPanelOpen] = useState(false);
  const [clock, setClock] = useState(() => fmtClock());
  const [weather, setWeather] = useState("");
  // Queue hydrates from localStorage in the initializer — this component only
  // mounts client-side (dynamic ssr:false), and a broken/blocked storage just
  // yields an empty queue.
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
      return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
    } catch {
      return [];
    }
  });

  // ── Clock ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setClock(fmtClock()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Weather (Open-Meteo, no key): on load + on board select ──────────────
  useEffect(() => {
    const lat = selected?.lat ?? SF_CENTER[1];
    const lng = selected?.lng ?? SF_CENTER[0];
    let stale = false;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,weather_code,is_day`
    )
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json: { current?: { temperature_2m?: number; weather_code?: number } }) => {
        if (stale) return;
        const t = json.current?.temperature_2m;
        const word = weatherWord(json.current?.weather_code ?? -1);
        setWeather(typeof t === "number" ? `${Math.round(t)}°C ${word}` : word);
      })
      .catch(() => {
        if (!stale) setWeather("—"); // cockpit shows a dash; never blocks the map
      });
    return () => {
      stale = true;
    };
  }, [selected]);

  // ── Queue persistence ─────────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch {
      // storage full/blocked — queue still works in-memory for the session
    }
  }, [queue]);

  // ── Map init (once) ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/dark",
      center: SF_CENTER,
      zoom: 12.6,
      pitch: 55,
      bearing: -15,
      attributionControl: { compact: true },
      // Keep the WebGL buffer readable so screenshots / canvas exports of the
      // scene (demo captures, future PDF reports) don't come back black.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      if (disposed) return;

      // 3D buildings from the style's own vector source. A style change or a
      // missing source-layer must never crash the page — flat map fallback.
      try {
        const styleLayers = map.getStyle().layers ?? [];
        const firstSymbol = styleLayers.find((l) => l.type === "symbol")?.id;
        map.addLayer(
          {
            id: "ob-3d-buildings",
            type: "fill-extrusion",
            source: "openmaptiles",
            "source-layer": "building",
            minzoom: 13,
            paint: {
              "fill-extrusion-color": "#26262b",
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.75,
            },
          } as LayerSpecification,
          firstSymbol
        );
      } catch {
        // style without openmaptiles buildings → flat map, still functional
      }

      // Billboard dots. Fetch failure → basemap stays up, count reads 0.
      fetch("/sf-billboards.geojson")
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((gj: GeoJSON.FeatureCollection) => {
          if (disposed) return;
          try {
            const index = new Map<string, BoardSel>();
            for (const f of gj.features) {
              if (f.geometry?.type !== "Point") continue;
              const [lng, lat] = f.geometry.coordinates as [number, number];
              const b = toBoard((f.properties ?? {}) as Record<string, unknown>, lng, lat);
              index.set(b.recordId, b);
            }
            boardsIndexRef.current = index;
            setBoardCount(index.size);

            map.addSource("ob-boards", { type: "geojson", data: gj });
            // Highlight ring goes under the dots so the dot stays crisp.
            map.addLayer({
              id: "ob-board-halo",
              type: "circle",
              source: "ob-boards",
              filter: ["==", ["get", "record_id"], "__none__"],
              paint: {
                "circle-radius": [
                  "interpolate", ["linear"], ["zoom"],
                  11, 9, 14, 12, 16, 16,
                ],
                "circle-color": "rgba(245,212,0,0.16)",
                "circle-stroke-color": "#F5D400",
                "circle-stroke-width": 2,
              },
            } as LayerSpecification);
            map.addLayer({
              id: "ob-board-dots",
              type: "circle",
              source: "ob-boards",
              paint: {
                "circle-radius": [
                  "interpolate", ["linear"], ["zoom"],
                  11, 3, 13.5, 4.5, 16, 7,
                ],
                "circle-color": "#F5D400",
                "circle-stroke-color": "#0B0B0B",
                "circle-stroke-width": 1,
              },
            } as LayerSpecification);
          } catch {
            // duplicate source on hot-reload etc. — ignore, dots already there
          }
        })
        .catch(() => {
          if (!disposed) setBoardCount(0);
        });

      map.on("click", "ob-board-dots", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const b = toBoard((f.properties ?? {}) as Record<string, unknown>, lng, lat);
        setSelected(b);
        setPanelOpen(true);
        setMode((m) => (m === "QUEUE" ? "INVENTORY" : m));
      });
      map.on("mouseenter", "ob-board-dots", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "ob-board-dots", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      disposed = true;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // ── Selection → highlight ring + camera move ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      if (map.getLayer("ob-board-halo")) {
        map.setFilter("ob-board-halo", [
          "==",
          ["get", "record_id"],
          selected?.recordId ?? "__none__",
        ]);
      }
      if (selected) {
        map.flyTo({
          center: [selected.lng, selected.lat],
          zoom: 15.5,
          pitch: 55,
          duration: 1600,
          essential: true,
        });
      }
    } catch {
      // style mid-swap — highlight simply skips a beat
    }
  }, [selected]);

  // ── Cockpit / dossier handlers ────────────────────────────────────────────
  const handleMode = useCallback(
    (m: CockpitMode) => {
      if ((m === "VISIBILITY" || m === "ADVERTISERS") && !selected) return;
      setMode(m);
      setPanelOpen(true);
    },
    [selected]
  );

  const handleAddQueue = useCallback((item: QueueItem) => {
    setQueue((q) =>
      q.some((x) => x.recordId === item.recordId && x.advertiserName === item.advertiserName)
        ? q
        : [...q, item]
    );
  }, []);

  const handleRemoveQueue = useCallback((index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index));
  }, []);

  const handleJumpToBoard = useCallback((recordId: string) => {
    const b = boardsIndexRef.current.get(recordId);
    if (!b) return;
    setSelected(b);
    setMode("INVENTORY");
    setPanelOpen(true);
  }, []);

  // Dev/demo handle: lets scripts and the console drive board selection
  // (also used by the E2E harness — canvas pixel-clicks on a 3D map are flaky).
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__orangeboard = {
      selectBoard: handleJumpToBoard,
      map: () => mapRef.current,
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__orangeboard;
    };
  }, [handleJumpToBoard]);

  const showPanel = panelOpen && (mode === "QUEUE" || selected !== null);

  return (
    <div className="fixed inset-0 bg-[#111]">
      {/* w/h-full (not inset-0 alone): maplibre-gl.css forces the container to
          position:relative, which would collapse an inset-sized div to 0h. */}
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />

      {/* Wordmark chip — light console over dark map: the Voyagent identity */}
      <div
        className="absolute top-4 left-4 z-20 px-3 py-2"
        style={{
          background: "rgba(255,255,255,0.94)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        <p style={{ ...MONO_LABEL, fontSize: "11px", fontWeight: 700, color: "#262626" }}>
          Voya<span style={{ color: ORANGE }}>gent</span>
        </p>
        <p style={{ ...MONO_LABEL, fontSize: "7.5px", color: "#a3a3a3" }}>
          Sell the audience, not the space
        </p>
      </div>

      {showPanel && (
        <Dossier
          mode={mode}
          board={selected}
          queue={queue}
          onAddQueue={handleAddQueue}
          onRemoveQueue={handleRemoveQueue}
          onClose={() => setPanelOpen(false)}
          onJumpToBoard={handleJumpToBoard}
        />
      )}

      <Cockpit
        mode={mode}
        onMode={handleMode}
        boardCount={boardCount}
        selectedId={selected?.recordId ?? null}
        clock={clock}
        weather={weather}
        queueCount={queue.length}
      />
    </div>
  );
}
