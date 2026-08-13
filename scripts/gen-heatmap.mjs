// Generates data/traffic-heatmap.json — weighted [lat, lng, intensity] points
// sampled along SF's high-traffic corridors. Feed straight to leaflet.heat.
// Run: node scripts/gen-heatmap.mjs   (writes ../data/traffic-heatmap.json)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Each corridor: an ordered list of [lat, lng] waypoints + a base intensity
// (0..1) reflecting relative traffic volume. Points are interpolated between
// waypoints and jittered so the heat blob has natural width.
const CORRIDORS = [
  {
    name: "US-101",
    intensity: 1.0,
    points: [
      [37.8100, -122.4020], // Central Fwy / Octavia
      [37.7720, -122.4090], // SoMa
      [37.7690, -122.4075], // Vermont St (flagship board)
      [37.7480, -122.4055], // Cesar Chavez
      [37.7250, -122.4010], // Bayshore
      [37.7080, -122.4030], // Alemany maze
    ],
  },
  {
    name: "I-280",
    intensity: 0.85,
    points: [
      [37.7700, -122.3950], // Mariposa on-ramp
      [37.7530, -122.4050], // Cesar Chavez
      [37.7350, -122.4340], // Alemany
      [37.7180, -122.4530], // Ocean Ave
      [37.7052, -122.4649], // Daly City approach (board)
    ],
  },
  {
    name: "Market St",
    intensity: 0.9,
    points: [
      [37.7946, -122.3948], // Embarcadero
      [37.7896, -122.4009], // Montgomery / FiDi
      [37.7846, -122.4072], // Powell (board)
      [37.7758, -122.4183], // Van Ness
      [37.7702, -122.4269], // Church / upper Market
    ],
  },
  {
    name: "Mission St",
    intensity: 0.8,
    points: [
      [37.7770, -122.4190], // Mission @ Van Ness area
      [37.7645, -122.4200], // 16th St
      [37.7525, -122.4183], // 24th St (board)
      [37.7405, -122.4230], // 30th / Bernal
    ],
  },
  {
    name: "Marina / Chestnut-Lombard",
    intensity: 0.65,
    points: [
      [37.8005, -122.4470], // Lombard @ Divisadero
      [37.8005, -122.4360], // Chestnut @ Fillmore (board)
      [37.8020, -122.4240], // Lombard @ Van Ness
      [37.8035, -122.4110], // Bay St toward the Wharf
    ],
  },
];

// Linear interpolation between two [lat,lng] points.
const lerp = (a, b, t) => a + (b - a) * t;
// Small random jitter (~40-90m) so points form a band, not a hairline.
const jitter = () => (Math.random() - 0.5) * 0.0016;

const out = [];
const SAMPLES_PER_SEGMENT = 16; // ~16 pts between each waypoint pair

for (const corridor of CORRIDORS) {
  const wp = corridor.points;
  for (let i = 0; i < wp.length - 1; i++) {
    const [lat1, lng1] = wp[i];
    const [lat2, lng2] = wp[i + 1];
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      const t = s / SAMPLES_PER_SEGMENT;
      const lat = lerp(lat1, lat2, t) + jitter();
      const lng = lerp(lng1, lng2, t) + jitter();
      // Intensity wobbles ±15% around the corridor base for texture.
      const intensity = +(
        corridor.intensity * (0.85 + Math.random() * 0.3)
      ).toFixed(3);
      out.push([+lat.toFixed(5), +lng.toFixed(5), Math.min(1, intensity)]);
    }
  }
}

const outPath = join(__dirname, "..", "data", "traffic-heatmap.json");
writeFileSync(outPath, JSON.stringify(out));
console.log(`Wrote ${out.length} heatmap points to ${outPath}`);
