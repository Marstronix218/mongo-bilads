# Sponsors Integration Guide

The approved sponsor tools for BilAds are:

- **Cursor**
- **ElevenLabs**
- **Fireworks**
- **LangChain**
- **MongoDB**
- **VoyageAI**
- **OpenRouter**

All previous sponsor integrations (InsForge, GMI Cloud, Nimble, BAND, Kylon)
have been removed. The app currently runs fully on localhost: campaigns and
agent runs persist to a local JSON store (`app/lib/localdb.ts`), location
intelligence comes from the committed `data/signals/` dataset, and the
five-agent review room is generated deterministically (`app/lib/room.ts`).

## Current status

| Sponsor | Status | Where it fits |
| --- | --- | --- |
| MongoDB | Integrated | Server-only Atlas connection (`app/lib/mongodb.ts`); health check at `GET /api/health/mongodb`. Candidate replacement for the local JSON store. |
| OpenRouter / Fireworks | Not yet wired | The AI layer (`app/lib/openai.ts`) is OpenAI-compatible; either provider can serve chat/vision by overriding the base URL and model env vars. |
| VoyageAI | Not yet wired | Embeddings for audience/interest matching — could replace the keyword→tag fallback in `app/lib/researcher.ts` and power semantic board ranking. |
| LangChain | Not yet wired | Orchestration for the researcher → media buyer → creative pipeline (`/api/research`, `/api/generate`). |
| ElevenLabs | Not yet wired | Voiceover for campaign presentations or an audio walkthrough of the review room discussion. |
| Cursor | Tooling | Development workflow; no runtime integration required. |
