# Steven — Frontend & Demo Driver

**Role:** Frontend, UI/UX, demo presentation, sponsor UI surfaces.

Steven owns everything the user sees: the landing page, agent theater, map, creative panel, simulation, and all sponsor-facing UI. Steven drives the 2-minute pitch.

---

## Phase 0: Setup (0:00-0:15)

- [x] Scaffold Next.js: `npx create-next-app@latest bilads --typescript --tailwind --app`
- [x] Install deps: `leaflet react-leaflet leaflet.heat perspective-transform openai recharts`
- [x] Copy `types.ts` into `app/lib/types.ts` — shared contract
- [x] Add Google Fonts to `app/layout.tsx`: Space Grotesk (display) + JetBrains Mono (mono)
- [x] Extend Tailwind theme with palette tokens: `bg: #0B0B0B`, `fg: #F5F1E8`, `accent: #F5D400`, `surface: #2A2A2A`

---

## Phase 1: Landing Page (0:15-1:00)

- [x] `app/page.tsx`: `BILADS` wordmark at hero size, tagline "Billboards, decided." underneath
- [x] Upload form component:
  - Image drop zone (accepts product image, previews it)
  - Text inputs: name, description, target audience
  - Weekly budget ($) input
  - Campaign duration (weeks, default 4)
  - Awareness <-> Targeted slider (0-1, default 0.5)
- [x] "Deploy agent team" CTA button in accent yellow
- [x] Three sample product cards row below the form — reads from `lib/samples.ts` (Volt, Fog City Coffee, Ledgerly)
  - One click prefills entire form + previews product image
- [x] Build `<AgentCard name status findings />` component — used 3x on results screen

---

## Phase 2: Agent Theater (1:00-2:00)

- [x] `app/results/page.tsx` shell — on mount, POST to `/api/research` with form state
- [x] Sequential card activation:
  - Card 1 (Researcher) goes "active" immediately, typewriter-reveals 4 findings (~25ms/char)
  - Card 2 (Media Buyer) activates after Card 1 finishes (4s delay), typewriter-reveals its 4 findings
  - Card 3 (Creative Director) stays "waiting" until a board is opened
- [x] Silent handoffs: Card 1 dims to "complete" state, Card 2 lights up. No cross-agent chatter.

### Sponsor: BAND Collaboration View

- [x] "View agent discussion" toggle in sidebar that shows BAND-style conversation
- [x] Chat-like UI with messages from 5 agents:
  - Research Agent posts location findings
  - Media Planner explains channel reasoning
  - Creative Director states concept rationale
  - Risk Agent flags brand safety issues and rejected variants
  - Human approval step at the end
- [x] Messages appear sequentially with 800ms delay for dramatic effect
- [x] Agent name, role label, emoji, and message type coloring (findings/recommendations/warnings/approvals)

---

## Phase 3: Results Page — Map + Info Cards (1:00-2:00)

- [x] Fullscreen `react-leaflet` map centered on SF with dark CartoDB tiles
- [x] `leaflet.heat` layer with toggle button ("Show/Hide traffic"), 304 weighted points along SF corridors
- [x] Pin component for top-3 boards from `mediaBuyer.top3` — each pin shows rank number in yellow badge
- [x] Sticky top bar: budget input + awareness slider + duration input, all bound to state
  - Changing any value re-filters `mediaBuyer.rankings` client-side (recompute `valueScore` with corrected formula)
  - Re-drops pins — **this is the demo slider moment**
- [x] Click pin -> floating info card over the map:
  - Rank badge, name, weekly cost, `demoMatch %`, Media Buyer `reason`
  - Overall location score badge
  - "Design ads" button
- [x] Empty state: if no boards in budget, full-screen message with raise-to amount

### Sponsor: Location Scoring Panel

- [x] Collapsible "Location Score" breakdown inside each info card:
  - Audience fit (25%), Traffic (20%), Viewing quality (15%), Context (15%), Competitor opportunity (10%), Cost efficiency (10%), Data confidence (5%)
  - Each factor shows: score with progress bar, evidence text
  - Overall weighted score badge
- [x] Source attribution: "Nimble market intelligence + SF Planning permits"

---

## Phase 4: Creative Panel (2:00-3:00)

- [x] On "Design ads" click, full-page overlay panel over the map
- [x] POST to `/api/generate` with `{billboardId, brief, audienceProfile, consistentBrand, variant: 0}`
- [x] Two concept cards side-by-side with **canvas-based perspective warp composite**:
  - Billboard photo with generated ad warped onto the board using `adCorners` + bilinear interpolation grid
  - Headline + subline drawn as text overlay on canvas
  - Language badge (EN/ES) top-right
  - Falls back to flat image if billboard photo not available
- [x] Per-card "Regenerate" button -> same endpoint with `variant++` (local counter)
- [x] "Consistent brand" toggle at panel top — re-fires generate when flipped
- [x] "Back to map" button
- [x] **Mission board shows English + Spanish** — `spanishFriendly` flag drives EN/ES concept split
- [x] Sponsor badges footer: "Creatives by GMI Cloud | Intelligence by Nimble | Powered by InsForge"

---

## Phase 5: Simulation (3:00-3:30)

- [x] "Simulate campaign" button in creative panel
- [x] Day-by-day animated SVG time-series chart:
  - Draws cumulative impressions (yellow) + target reach (green) day by day, ~80ms/day
- [x] Stats below chart: total impressions, total spend, blended CPM, est. CPA
- [x] Three-scenario table: Conservative / Base (highlighted) / Optimistic with estimated reach, responses, conversions
- [x] Disclaimer: "These are scenario estimates, not predictions."
- [x] Assumptions listed in mono footer text

---

## Phase 6: Sponsor UI Surfaces

### Kylon Workspace Panel

- [x] Kylon workspace status in agent sidebar showing:
  - Market research: complete
  - Media planning: complete
  - Creative generation: pending/complete (tracks creative panel state)
  - Campaign packaging: pending
- [x] Status dots: green (complete), yellow pulse (active), grey (pending)

### InsForge Integration

- [x] "Powered by InsForge" in creative panel footer
- [ ] Full campaign history page (stretch goal — requires InsForge backend)
- [ ] User login/auth UI (stretch goal — requires InsForge backend)

### Nimble Data Attribution

- [x] "Source: Nimble market intelligence + SF Planning permits" in location scoring panel
- [x] "Intelligence by Nimble" in creative panel sponsor footer
- [x] Sponsor attribution in sidebar: "Data: Nimble + SF Planning"

### Overall Sponsor Attribution

- [x] Sidebar footer: Data (Nimble), Agents (BAND), Workforce (Kylon), Backend (InsForge)

---

## Phase 7: Rehearsal (3:30-4:00)

- [ ] Wire up cached AI outputs so the live pipeline is bypassed when `?cached=1` or a "demo mode" flag is set
- [ ] Two full dry-runs of the 2-min flow
- [ ] Confirm fallback: kill wifi, hit regenerate, ensure cached variant swaps in silently
- [ ] Practice the pitch script (PRD §2)

---

## What's Built (files)

| File | What it does |
|---|---|
| `app/app/layout.tsx` | Root layout with Space Grotesk + JetBrains Mono, dark theme |
| `app/app/globals.css` | Tailwind config with bilads color tokens |
| `app/app/page.tsx` | Landing page: wordmark, form, samples, CTA |
| `app/app/results/page.tsx` | Results: agent theater, map, info cards, creative panel, simulation, sponsor surfaces |
| `app/app/results/MapView.tsx` | Leaflet map with dark tiles, ranked pins, heatmap layer, auto-fit bounds |
| `app/app/results/BillboardComposite.tsx` | Canvas-based perspective warp of ad onto billboard photo |
| `app/app/results/BandDiscussion.tsx` | BAND agent collaboration chat with 5-agent discussion |
| `app/app/api/research/route.ts` | Mock research endpoint with deterministic Jaccard scoring |
| `app/app/api/generate/route.ts` | Mock generate endpoint with EN/ES concept templates |
| `app/app/api/placeholder/route.ts` | SVG placeholder image generator |
| `app/lib/types.ts` | Shared TypeScript contracts (copied from repo root) |
| `app/lib/samples.ts` | 3 sample product briefs |
| `app/lib/billboards.json` | 14 curated SF billboard records |
| `app/lib/traffic-heatmap.json` | 304 heatmap points for leaflet.heat |
| `app/lib/leaflet-heat.d.ts` | Type declaration for leaflet.heat module |

---

## Demo Script Cheat Sheet

| Moment | What to do | What to say |
|---|---|---|
| Open | Click Volt sample | "Buying a billboard today is broken..." |
| Agent theater | Let it run, expand BAND discussion | "Our agents research, plan, and debate — visible reasoning, not a black box" |
| Slider drag | Move awareness -> targeted | "Watch the rankings reorder — zero API calls" |
| Heatmap | Toggle "Show traffic" | "Real SF traffic corridors from Nimble intelligence" |
| Mission board | Click pin, open creative | "Same board, two concepts — one in Spanish for the 38% Latino neighborhood" |
| Location score | Expand score breakdown | "Seven weighted factors, all backed by Nimble data and SF permits" |
| Simulation | Click simulate | "Day-by-day projected reach across three scenarios" |
| Regenerate | Click regenerate on one card | "Everything was cached — watch this one run live via GMI Cloud" |
| Close | Pause | "Billboards, decided." |

---

## Q&A Role

Steven answers: product vision, UX decisions, why map-first, why the slider matters, category framing ("AI agent product that happens to do billboards"), competitive positioning vs Caasie, sponsor integration strategy.
