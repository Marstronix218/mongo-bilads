"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { CustomLayerInterface, CustomRenderMethodInput } from "maplibre-gl";
import * as THREE from "three";
import "maplibre-gl/dist/maplibre-gl.css";
import type { AdConcept, Billboard } from "@/lib/types";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const PANEL_W = 18;
const PANEL_H = 6.2;
const CLEARANCE = 8;
const POLE_R = 0.16;
const POLE_INSET = PANEL_W * 0.28;

const DEMO_STREET_VIEW: Record<
  string,
  { lat: number; lng: number; heading: number; pitch?: number; fov?: number }
> = {
  "sf-101-vermont": { lat: 37.776837224000076, lng: -122.40296556099997, heading: 90 },
  "sf-280-dalycity": { lat: 37.77007049200006, lng: -122.40553258899996, heading: 0 },
  "sf-market-downtown": { lat: 37.77007049200006, lng: -122.40553258899996, heading: 0 },
  "sf-mission-24th": { lat: 37.777518085000054, lng: -122.412676525, heading: 90 },
  "sf-marina-chestnut": { lat: 37.77716378000008, lng: -122.40770925099997, heading: 90 },
  "sf-valencia-mission": { lat: 37.77716378000008, lng: -122.40770925099997, heading: 90 },
  "sf-hayes-valley": { lat: 37.77674359900004, lng: -122.408239864, heading: 90 },
  "sf-sunset-irving": { lat: 37.77007049200006, lng: -122.40553258899996, heading: 270 },
  "sf-financial-montgomery": { lat: 37.77007049200006, lng: -122.40553258899996, heading: 90 },
  "sf-union-square": { lat: 37.788125336000064, lng: -122.4037439, heading: 0 },
  "sf-soma-harrison": { lat: 37.779717651000055, lng: -122.40054211699999, heading: 180 },
  "sf-richmond-geary": { lat: 37.776837224000076, lng: -122.40296556099997, heading: 90 },
  "sf-dogpatch-3rd": { lat: 37.77007049200006, lng: -122.40553258899996, heading: 90 },
  "sf-embarcadero-ferry": { lat: 37.779717651000055, lng: -122.40054211699999, heading: 270 },
};

type DetectionResponse = {
  quad: [[number, number], [number, number], [number, number], [number, number]] | null;
  confidence?: number;
  reason?: string;
  source?: string;
};

declare global {
  interface Window {
    google?: {
      maps?: {
        StreetViewPanorama: new (
          element: HTMLElement,
          options: Record<string, unknown>
        ) => GoogleStreetViewPanorama;
        StreetViewStatus?: { OK: string };
      };
    };
    __biladsGoogleMapsPromise?: Promise<void>;
  }
}

type GoogleStreetViewPanorama = {
  getPov: () => { heading?: number; pitch?: number };
  addListener: (eventName: string, handler: () => void) => { remove: () => void };
};

export default function SimulationStreetView({
  board,
  concept,
}: {
  board: Billboard;
  concept: AdConcept;
}) {
  const panoRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  const [status, setStatus] = useState<"loading" | "curated" | "not-found">("loading");

  useEffect(() => {
    setFallback(false);
    setStatus("loading");
    const container = panoRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;
    const containerEl = container;
    const overlayEl = overlay;

    const demoView = DEMO_STREET_VIEW[board.id];
    const heading = demoView?.heading ?? streetHeading(board);
    const position = demoView
      ? { lat: demoView.lat, lng: demoView.lng }
      : offsetPoint(board.lat, board.lng, heading + 180, board.trafficType === "vehicle" ? 22 : 14);
    const pitch = demoView?.pitch ?? 5;
    let cancelled = false;
    let povListener: { remove: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      try {
        await loadGoogleMaps();
        if (cancelled || !window.google?.maps?.StreetViewPanorama) return;

        const panorama = new window.google.maps.StreetViewPanorama(containerEl, {
          position,
          pov: { heading, pitch },
          zoom: 0,
          motionTracking: false,
          motionTrackingControl: false,
          addressControl: false,
          fullscreenControl: true,
          linksControl: true,
          panControl: true,
          showRoadLabels: true,
          zoomControl: true,
          visible: true,
        });

        const draw = async () => {
          const rect = overlayEl.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          const quad = boardCornersToQuad(board, rect.width, rect.height);
          if (!quad) {
            setStatus("not-found");
          clearOverlay(overlayEl);
            return;
          }
          const creative = await loadImage(concept.imageUrl);
          if (cancelled) return;
          setStatus("curated");
          drawBillboardOverlay(overlayEl, creative, concept, quad);
        };

        const scheduleDraw = () => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => void draw());
          });
        };

        scheduleDraw();
        resizeObserver = new ResizeObserver(() => void draw());
        resizeObserver.observe(containerEl);
        povListener = panorama.addListener("pov_changed", () => {
          const pov = panorama.getPov();
          overlayEl.style.opacity = String(1 - Math.min(0.72, angularDiff(pov.heading ?? heading, heading) / 70));
          scheduleDraw();
        });
      } catch {
        if (!cancelled) setFallback(true);
      }
    }

    void init();

    return () => {
      cancelled = true;
      povListener?.remove();
      resizeObserver?.disconnect();
      clearOverlay(overlayEl);
    };
  }, [board, concept]);

  if (fallback) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-bilads-fg/10 bg-black">
        <canvas
          ref={(node) => {
            if (!node) return;
            drawStaticFallback(node, board, concept);
          }}
          className="block aspect-video w-full"
        />
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-bilads-fg/10 bg-black">
      <div ref={panoRef} className="relative z-0 aspect-video w-full" />
      <canvas
        ref={overlayRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full transition-opacity duration-150"
      />
      <div className="pointer-events-none absolute left-8 top-8 z-20 rounded bg-black/78 px-5 py-4 shadow-xl backdrop-blur">
        <p className="text-[15px] font-mono uppercase tracking-[0.32em] text-bilads-accent">
          Interactive Street View
        </p>
        <p className="mt-2 text-2xl text-bilads-fg/65">
          {board.name} · {board.neighborhood}
        </p>
        <p className="mt-3 max-w-[520px] text-sm font-mono uppercase tracking-[0.18em] text-bilads-fg/45">
          {status === "curated"
            ? "Move around the street scene"
            : status === "not-found"
              ? "No verified board face for this POV"
              : "Loading Google Street View"}
        </p>
      </div>
    </div>
  );
}

async function loadGoogleMaps(): Promise<void> {
  if (window.google?.maps?.StreetViewPanorama) return;
  if (window.__biladsGoogleMapsPromise) return window.__biladsGoogleMapsPromise;

  window.__biladsGoogleMapsPromise = fetch("/api/google-maps-key")
    .then(async (res) => {
      if (!res.ok) throw new Error("Google Maps key unavailable");
      return (await res.json()) as { key: string };
    })
    .then(
      ({ key }) =>
        new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>("script[data-bilads-google-maps]");
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Google Maps failed to load")), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.dataset.biladsGoogleMaps = "true";
          script.async = true;
          script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Google Maps failed to load"));
          document.head.appendChild(script);
        })
    );

  return window.__biladsGoogleMapsPromise;
}

function boardCornersToQuad(
  board: Billboard,
  width: number,
  height: number
): [[number, number], [number, number], [number, number], [number, number]] | null {
  if (!Array.isArray(board.adCorners) || board.adCorners.length !== 4) return null;
  const refW = 640;
  const refH = 360;
  const scaleX = width / refW;
  const scaleY = height / refH;
  const quad = board.adCorners.map(([x, y]) => [
    Math.max(0, Math.min(width, x * scaleX)),
    Math.max(0, Math.min(height, y * scaleY)),
  ]) as [[number, number], [number, number], [number, number], [number, number]];
  const area =
    0.5 *
    Math.abs(
      quad.reduce((sum, [x, y], i) => {
        const [nx, ny] = quad[(i + 1) % quad.length];
        return sum + x * ny - nx * y;
      }, 0)
    );
  return area > width * height * 0.002 ? quad : null;
}

function clearOverlay(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function prepareOverlayCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function drawBillboardOverlay(
  canvas: HTMLCanvasElement,
  creative: HTMLImageElement | undefined,
  concept: AdConcept,
  quad: [[number, number], [number, number], [number, number], [number, number]]
) {
  const prepared = prepareOverlayCanvas(canvas);
  if (!prepared) return;
  const { ctx } = prepared;
  const corners = quad.map(([x, y]) => ({ x, y })) as [Point, Point, Point, Point];
  const billboard = renderCreativeCanvas(creative, concept);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.58)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  tracePolygon(ctx, corners);
  ctx.fillStyle = "#050505";
  ctx.fill();
  ctx.restore();

  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.86)";
  tracePolygon(ctx, corners);
  ctx.stroke();
  drawPerspectiveImage(ctx, billboard, corners);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  tracePolygon(ctx, corners);
  ctx.stroke();
}

function angularDiff(a: number, b: number): number {
  return Math.abs((((a - b + 540) % 360) + 360) % 360 - 180);
}

async function drawStaticFallback(canvas: HTMLCanvasElement, board: Billboard, concept: AdConcept) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = 1280;
  const height = 720;
  canvas.width = width;
  canvas.height = height;

  const street = await loadImage(board.photo);
  if (street) drawCover(ctx, street, width, height);
  else {
    ctx.fillStyle = "#090909";
    ctx.fillRect(0, 0, width, height);
  }
  drawStreetVignette(ctx, width, height);
  const quad = boardCornersToQuad(board, width, height);
  const creative = await loadImage(concept.imageUrl);
  if (quad && street) drawDetectedBillboardComposite(ctx, street, creative, concept, width, height, quad);
}

async function detectBillboard(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  boardName: string
): Promise<DetectionResponse> {
  const imageUrl = canvas.toDataURL("image/jpeg", 0.62);
  const detect = await fetch("/api/detect-billboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, imageW: width, imageH: height, boardName }),
  });
  return (await detect.json()) as DetectionResponse;
}

function readDetectionCache(key: string): DetectionResponse | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: DetectionResponse; expiresAt?: number };
    if (!parsed.value || !parsed.expiresAt || parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function writeDetectionCache(key: string, value: DetectionResponse) {
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({ value, expiresAt: Date.now() + 60 * 60 * 1000 })
    );
  } catch {}
}

function Simulation3DMap({
  board,
  concept,
  compact = false,
}: {
  board: Billboard;
  concept: AdConcept;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [board.lng, board.lat],
      zoom: 18.05,
      pitch: 72,
      bearing: board.trafficType === "vehicle" ? -36 : -18,
      attributionControl: { compact: true },
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });

    let disposed = false;
    let layer: ReturnType<typeof createBillboardLayer> | null = null;
    const onStyleImageMissing = (event: { id: string }) => {
      if (map.hasImage(event.id)) return;
      map.addImage(event.id, {
        width: 1,
        height: 1,
        data: new Uint8Array([0, 0, 0, 0]),
      });
    };

    map.on("styleimagemissing", onStyleImageMissing);
    map.on("load", () => {
      if (disposed) return;

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
              "fill-extrusion-color": "#303036",
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 0],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.82,
            },
          },
          firstSymbol
        );
      } catch {
        // If this style lacks building layers, the billboard mesh still renders.
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
          "circle-radius": 28,
          "circle-color": "rgba(245,212,0,0.16)",
          "circle-stroke-color": "#f5d400",
          "circle-stroke-width": 4,
        },
      });

      layer = createBillboardLayer({
        id: "sim-billboard-mesh",
        board,
        concept,
      });
      map.addLayer(layer);

      // Nudge the camera so the sign dominates the viewport instead of sitting
      // directly under the center crosshair.
      map.easeTo({
        center: [board.lng, board.lat],
        zoom: 18.15,
        pitch: 72,
        bearing: board.trafficType === "vehicle" ? -36 : -18,
        duration: 650,
      });
    });

    return () => {
      disposed = true;
      try {
        if (layer && map.getLayer(layer.id)) map.removeLayer(layer.id);
      } catch {}
      map.remove();
    };
  }, [board, concept]);

  return (
    <div className="relative h-full min-h-[320px] overflow-hidden rounded-lg border border-bilads-fg/10 bg-black">
      <div ref={containerRef} className={compact ? "h-full min-h-[320px] w-full" : "h-[460px] w-full"} />
      <div className="pointer-events-none absolute left-8 top-8 rounded bg-black/78 px-5 py-4 shadow-xl backdrop-blur">
        <p className="text-[15px] font-mono uppercase tracking-[0.32em] text-bilads-accent">
          3D Location Context
        </p>
        <p className="mt-2 text-2xl text-bilads-fg/65">
          {board.name} · {board.neighborhood}
        </p>
        <p className="mt-3 max-w-[320px] text-xs font-mono uppercase tracking-[0.16em] text-bilads-fg/40">
          Interactive map model at selected coordinates
        </p>
      </div>
    </div>
  );
}

function streetHeading(board: Billboard): number {
  return ((((boardHeading(board) * 180) / Math.PI) % 360) + 360) % 360;
}

function offsetPoint(lat: number, lng: number, bearingDeg: number, meters: number) {
  const earthRadius = 6378137;
  const bearing = (bearingDeg * Math.PI) / 180;
  const distance = meters / earthRadius;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distance) +
      Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1),
      Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2)
    );
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI };
}

function drawDetectionPending(
  ctx: CanvasRenderingContext2D,
  street: HTMLImageElement,
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);
  drawCover(ctx, street, width, height);
  drawStreetVignette(ctx, width, height);
}

function drawNoDetectedBillboard(
  ctx: CanvasRenderingContext2D,
  street: HTMLImageElement,
  width: number,
  height: number,
  reason = "No real advertising face was visible from this Street View angle."
) {
  ctx.clearRect(0, 0, width, height);
  drawCover(ctx, street, width, height);
  drawStreetVignette(ctx, width, height);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(width * 0.08, height * 0.68, width * 0.62, 82);
  ctx.fillStyle = "#f5d400";
  ctx.font = "700 22px Arial, sans-serif";
  ctx.fillText("No existing billboard face detected", width * 0.105, height * 0.725);
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "16px Arial, sans-serif";
  ctx.fillText(reason.slice(0, 110), width * 0.105, height * 0.765, width * 0.56);
  ctx.restore();
}

function drawStreetVignette(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const vignette = ctx.createRadialGradient(
    width * 0.5,
    height * 0.42,
    height * 0.18,
    width * 0.5,
    height * 0.48,
    width * 0.72
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.46)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

function drawDetectedBillboardComposite(
  ctx: CanvasRenderingContext2D,
  street: HTMLImageElement,
  creative: HTMLImageElement | undefined,
  concept: AdConcept,
  width: number,
  height: number,
  quad: [[number, number], [number, number], [number, number], [number, number]]
) {
  ctx.clearRect(0, 0, width, height);
  drawCover(ctx, street, width, height);
  drawStreetVignette(ctx, width, height);

  const billboard = renderCreativeCanvas(creative, concept);
  const corners = quad.map(([x, y]) => ({ x, y })) as [Point, Point, Point, Point];
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.62)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  tracePolygon(ctx, corners);
  ctx.fillStyle = "#050505";
  ctx.fill();
  ctx.restore();

  ctx.lineJoin = "round";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "rgba(0,0,0,0.84)";
  tracePolygon(ctx, corners);
  ctx.stroke();
  drawPerspectiveImage(ctx, billboard, corners);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  tracePolygon(ctx, corners);
  ctx.stroke();
}

function loadImage(src: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

type Point = { x: number; y: number };

function renderCreativeCanvas(img: HTMLImageElement | undefined, concept: AdConcept): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  if (img) drawCover(ctx, img, canvas.width, canvas.height);
  else {
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#111827");
    grad.addColorStop(0.56, "#14532d");
    grad.addColorStop(1, "#0f766e");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.92)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 104px Arial, sans-serif";
  wrapText(ctx, concept.headline, canvas.width / 2, canvas.height * 0.43, canvas.width * 0.78, 104);
  ctx.font = "700 38px Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  wrapText(ctx, concept.subline, canvas.width / 2, canvas.height * 0.68, canvas.width * 0.72, 44);
  return canvas;
}

function drawPerspectiveImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  corners: [Point, Point, Point, Point] | Point[]
) {
  const cols = 24;
  const rows = 10;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u0 = x / cols;
      const v0 = y / rows;
      const u1 = (x + 1) / cols;
      const v1 = (y + 1) / rows;
      const p00 = quadPoint(corners, u0, v0);
      const p10 = quadPoint(corners, u1, v0);
      const p01 = quadPoint(corners, u0, v1);
      const p11 = quadPoint(corners, u1, v1);
      const sx = u0 * img.width;
      const sy = v0 * img.height;
      const sw = (u1 - u0) * img.width;
      const sh = (v1 - v0) * img.height;
      drawTexturedTriangle(
        ctx,
        img,
        { x: sx, y: sy },
        { x: sx + sw, y: sy },
        { x: sx, y: sy + sh },
        p00,
        p10,
        p01
      );
      drawTexturedTriangle(
        ctx,
        img,
        { x: sx + sw, y: sy },
        { x: sx + sw, y: sy + sh },
        { x: sx, y: sy + sh },
        p10,
        p11,
        p01
      );
    }
  }
}

function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  s0: Point,
  s1: Point,
  s2: Point,
  p0: Point,
  p1: Point,
  p2: Point
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();
  const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denom) < 0.0001) {
    ctx.restore();
    return;
  }
  const a =
    (p0.x * (s1.y - s2.y) + p1.x * (s2.y - s0.y) + p2.x * (s0.y - s1.y)) /
    denom;
  const b =
    (p0.x * (s2.x - s1.x) + p1.x * (s0.x - s2.x) + p2.x * (s1.x - s0.x)) /
    denom;
  const c =
    (p0.x * (s1.x * s2.y - s2.x * s1.y) +
      p1.x * (s2.x * s0.y - s0.x * s2.y) +
      p2.x * (s0.x * s1.y - s1.x * s0.y)) /
    denom;
  const d =
    (p0.y * (s1.y - s2.y) + p1.y * (s2.y - s0.y) + p2.y * (s0.y - s1.y)) /
    denom;
  const e =
    (p0.y * (s2.x - s1.x) + p1.y * (s0.x - s2.x) + p2.y * (s1.x - s0.x)) /
    denom;
  const f =
    (p0.y * (s1.x * s2.y - s2.x * s1.y) +
      p1.y * (s2.x * s0.y - s0.x * s2.y) +
      p2.y * (s0.x * s1.y - s1.x * s0.y)) /
    denom;
  ctx.transform(a, d, b, e, c, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function quadPoint(corners: Point[], u: number, v: number): Point {
  const top = lerpPoint(corners[0], corners[1], u);
  const bottom = lerpPoint(corners[3], corners[2], u);
  return lerpPoint(top, bottom, v);
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

function drawPole(ctx: CanvasRenderingContext2D, top: Point, bottom: Point) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 14;
  ctx.strokeStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  ctx.moveTo(top.x + 5, top.y + 8);
  ctx.lineTo(bottom.x + 8, bottom.y + 8);
  ctx.stroke();
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#32363b";
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.stroke();
  ctx.restore();
}

function createBillboardLayer({
  id,
  board,
  concept,
}: {
  id: string;
  board: Billboard;
  concept: AdConcept;
}): CustomLayerInterface {
  const origin = maplibregl.MercatorCoordinate.fromLngLat([board.lng, board.lat], 0);
  const scale = origin.meterInMercatorCoordinateUnits();
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const sceneTransform = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));

  let renderer: THREE.WebGLRenderer | null = null;
  let mapRef: maplibregl.Map | null = null;
  const panelMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    toneMapped: false,
    depthTest: false,
  });

  function build() {
    const group = new THREE.Group();
    const yaw = boardHeading(board);
    group.rotation.y = yaw;

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_W + 0.8, PANEL_H + 0.7, 0.34),
      new THREE.MeshBasicMaterial({ color: 0x070707, side: THREE.DoubleSide, depthTest: false })
    );
    frame.position.set(0, CLEARANCE + PANEL_H / 2, -0.08);
    group.add(frame);

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_W + 0.25, PANEL_H + 0.25, 0.16),
      new THREE.MeshBasicMaterial({ color: 0x1c2429, side: THREE.DoubleSide, depthTest: false })
    );
    back.position.set(0, CLEARANCE + PANEL_H / 2, -0.28);
    group.add(back);

    const face = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), panelMaterial);
    face.position.set(0, CLEARANCE + PANEL_H / 2, 0.12);
    group.add(face);

    const poleMaterial = new THREE.MeshBasicMaterial({
      color: 0x3c454c,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    for (const x of [-POLE_INSET, POLE_INSET]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(POLE_R, POLE_R * 1.08, CLEARANCE, 10),
        poleMaterial
      );
      pole.position.set(x, CLEARANCE / 2, -0.18);
      group.add(pole);
    }

    const brace = new THREE.Mesh(
      new THREE.BoxGeometry(PANEL_W * 0.64, 0.18, 0.18),
      poleMaterial
    );
    brace.position.set(0, CLEARANCE - 0.6, -0.18);
    group.add(brace);

    scene.add(group);
    loadCreativeTexture(concept, panelMaterial, () => mapRef?.triggerRepaint());
  }

  return {
    id,
    type: "custom" as const,
    renderingMode: "3d" as const,

    onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      mapRef = map;
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      renderer.autoClear = false;
      build();
    },

    render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput) {
      if (!renderer) return;
      camera.projectionMatrix = new THREE.Matrix4()
        .fromArray(Array.from(options.modelViewProjectionMatrix))
        .multiply(sceneTransform);
      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      scene.traverse((obj: THREE.Object3D) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat.dispose();
      });
      renderer?.dispose();
      renderer = null;
    },
  };
}

function boardHeading(board: Billboard): number {
  const text = `${board.id}:${board.lat.toFixed(5)}:${board.lng.toFixed(5)}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
  const deterministic = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const corridor = board.trafficType === "vehicle" ? -Math.PI / 5 : Math.PI / 9;
  return deterministic * 0.35 + corridor;
}

function loadCreativeTexture(
  concept: AdConcept,
  material: THREE.MeshBasicMaterial,
  onReady: () => void
) {
  const canvas = document.createElement("canvas");
  canvas.width = 1400;
  canvas.height = 480;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const draw = (img?: HTMLImageElement) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) drawCover(ctx, img, canvas.width, canvas.height);
    else {
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, "#111827");
      grad.addColorStop(1, "#0f766e");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 18;
    ctx.font = "900 104px Arial, sans-serif";
    wrapText(ctx, concept.headline, canvas.width / 2, canvas.height * 0.43, canvas.width * 0.78, 104);
    ctx.font = "700 38px Arial, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    wrapText(ctx, concept.subline, canvas.width / 2, canvas.height * 0.68, canvas.width * 0.72, 44);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    material.map?.dispose();
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    onReady();
  };

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => draw(img);
  img.onerror = () => draw();
  img.src = concept.imageUrl;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number
) {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const sw = width / scale;
  const sh = height / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const start = y - ((lines.length - 1) * lineHeight) / 2;
  lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, x, start + i * lineHeight, maxWidth));
}
