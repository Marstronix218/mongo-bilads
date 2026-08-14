# Bilads application

This directory contains the Next.js 16 application for Bilads. The product
turns a campaign brief into ranked San Francisco billboard placements,
location-aware creative concepts, street-scene mockups, an explicit approval
decision, and performance scenarios.

## Runtime architecture

- **MongoDB Atlas and GridFS** store campaigns, agent runs, creative versions,
  approvals, workflow checkpoints, and binary assets in production.
- **Fireworks** provides text, vision, image generation, and the optional
  embedding/reranking path.
- **LangGraph** provides the resumable creative-approval interrupt.
- **ElevenLabs** optionally creates cached audio briefings after approval.
- **OpenRouter** is restricted to explicit machine-authenticated Model Lab
  evaluations and is not a production fallback.
- Local JSON, disk, memory, keyword, and deterministic behavior keep local
  development usable when optional services are not configured.

## Setup

From the repository root:

```bash
cp .env.example app/.env.local
cd app
npm ci
npm run dev
```

Open `http://localhost:3000`. Configure `FIREWORKS_API_KEY` for live inference
and `MONGODB_URI` for production persistence. Optional provider and model
settings are documented in the root `.env.example`. Secrets must remain
server-only.

## Commands

```bash
npm run dev        # sync canonical data, then start development mode
npm run build      # sync canonical data, then create a production build
npm run start      # serve the production build
npm run lint       # run ESLint
npm run typecheck  # run the dedicated TypeScript check
npm run sync       # copy canonical root data into app/lib
```

The root [README](../README.md) contains the full architecture, environment,
data-provenance, and verification guide.
