# Sponsors Integration Guide

This document describes how each sponsor technology fits into the BilAds platform to maximize utility and create a cohesive, end-to-end AI-powered advertising system.

---

## Architecture Overview

```
User
  |
Frontend Dashboard
  |
InsForge
  ├── Authentication
  ├── Product and campaign database
  ├── File/image storage
  ├── Agent job state
  └── Campaign history
       |
Kylon AI Marketing Team
  ├── Research assignment
  ├── Media planning assignment
  ├── Creative assignment
  └── Campaign packaging
       |
BAND Collaboration Room
  ├── Research Agent
  ├── Media Planner
  ├── Creative Director
  ├── Performance Analyst
  └── Risk Agent
       |
External Capabilities
  ├── Nimble  --> live web/location intelligence
  └── GMI Cloud --> image generation
       |
Simulation and Recommendation
       |
Human Approval
```

---

## 1. Nimble — Live Market and Location Intelligence

**Role:** Research and data-acquisition layer.

Nimble provides web search, extraction, browser automation, and structured real-time web data for AI agents. It handles JavaScript-heavy websites and returns data in a form agents can process.

### What Nimble Collects

**For each candidate location:**

- Nearby businesses
- Retail density
- Tourism activity
- Local events
- Public-transit stations
- Universities
- Office districts
- Competitor locations
- Reviews and customer discussions
- Local purchasing-intent signals
- News about openings, developments, or neighborhood changes
- Billboard inventory pages and approximate pricing (where legally accessible)

**For digital platforms:**

- Platform usage by region
- Trending topics
- Search demand
- Competitor campaigns
- Customer complaints and product discussions
- Relevant creators or communities

### Example

A user uploads a new energy drink aimed at students. The Nimble research agent finds:

- University campuses
- Gyms and convenience stores
- High-traffic transit stops
- Upcoming music events
- Competing energy-drink promotions
- Student-oriented local language and interests

It returns structured evidence:

```json
{
  "location": "Market Street near Powell Station",
  "signals": [
    "high public transit activity",
    "nearby universities and retail",
    "large volume of young adult foot traffic",
    "multiple late-night businesses"
  ],
  "source_urls": [],
  "confidence": 0.84
}
```

### Why This Matters

Do not use Nimble merely to scrape one product website. Show that it gives the agents fresh market intelligence that changes the campaign recommendation.

---

## 2. GMI Cloud — Image and Creative Generation

**Role:** Generate the visual campaign assets.

GMI Cloud provides production AI inference infrastructure, OpenAI-compatible APIs, GPU capacity, and a model library containing many pre-deployed generative models. It is positioned for scalable generative-media and image-generation workloads.

### What to Generate

For each selected location or channel:

- Horizontal billboard creative
- Vertical digital-screen creative
- Square social-media ad
- Mobile-story format
- Localized product image
- Visual background adapted to the neighborhood
- Multiple headline and composition variants

### Location-Tailored Generation

The creative prompt should be assembled from:

- Brand identity
- Product features
- Target customer
- Local environment
- Viewing distance
- Expected attention time
- Screen dimensions
- Day versus night
- Legal and brand restrictions

### Example Prompt

> Create a minimal digital billboard for a sugar-free energy drink near a San Francisco transit station. Target commuting university students. Use no more than seven headline words, strong product visibility, high contrast, and a composition readable within three seconds.

### Important Limitation

Do not allow the image model to invent arbitrary logos, prices, nutritional claims, testimonials, or location facts. The workflow should separate:

- **Approved factual claims** (from the campaign brief)
- **Generated visual treatment** (from the model)

The final rendering agent may use only approved claims stored in the campaign brief.

---

## 3. BAND — Agent Collaboration and Decision Governance

**Role:** Where the specialist agents debate the campaign.

BAND is designed for humans and AI agents to work together in shared rooms while keeping context synchronized across agents. Its agent interfaces support multi-agent communication, recruitment, coordination, and collaborative workflows.

### Agents in the BAND Room

| Agent | Responsibility |
|---|---|
| **Market Research Agent** | Finds location, audience, competitor, and traffic signals through Nimble |
| **Media Planner Agent** | Chooses channels: billboard, digital out-of-home, Instagram, TikTok, search ads, or mixed campaign |
| **Creative Director Agent** | Defines the campaign concept and generates assets through GMI Cloud |
| **Performance Analyst Agent** | Runs the simulation and estimates expected reach, impressions, clicks, or conversions |
| **Risk and Brand Agent** | Checks for unsupported claims, brand consistency, offensive localization, sensitive targeting, unreadable designs, and unsuitable placements |

### What Judges Should See

Do not hide the agents behind a loading spinner. Show a BAND discussion such as:

> **Research Agent:** Location A has more traffic, but most activity occurs during commuter hours.
>
> **Media Planner:** Recommend digital billboard placements from 7-10 AM and mobile ads in the evening.
>
> **Creative Director:** A detailed visual will not work at this viewing distance. I recommend one product image and a six-word headline.
>
> **Risk Agent:** Reject variant two. It contains an unverified health-performance claim.
>
> **Human:** Approve location A and creative variant three.

The core value is not that agents "talk." It is that they expose different reasoning, identify conflicts, and require approval for consequential actions.

---

## 4. Kylon — Operating Workspace for the AI Marketing Team

**Role:** The persistent AI employee team that runs the campaign workflow.

Kylon is an AI-native workspace where agents understand company context, work alongside teams, and execute real business tasks.

### What Lives Inside Kylon

The company uploads:

- Brand guidelines
- Customer personas
- Prior campaign results
- Approved claims
- Prohibited language
- Campaign objectives
- Budget rules
- Geographic restrictions

Kylon's AI employees then receive assignments:

1. Research San Francisco campaign locations
2. Produce three media plans
3. Generate six creative variants
4. Prepare a budget allocation
5. Request approval
6. Create a final campaign package

### Relationship Between Kylon and BAND

These must be clearly distinguished:

| Platform | Purpose |
|---|---|
| **Kylon** | Where the company's AI marketing employees receive and execute ongoing business assignments |
| **BAND** | Where multiple agents and humans coordinate, challenge conclusions, and approve decisions |

Without that distinction, the integrations will look redundant.

**Clean framing:** Kylon manages the AI marketing workforce. BAND manages collaborative decision-making between that workforce and the human campaign owner.

---

## 5. InsForge — Application Backend and System of Record

**Role:** Power the actual customer-facing product.

InsForge provides model gateway, database, authentication, storage, compute, hosting, and deployment capabilities designed for agentic applications.

### What InsForge Stores

**User and organization data:**
- User accounts, teams, permissions, campaign ownership

**Product information:**
- Product uploads, website analysis, brand guidelines, target personas

**Geographic data:**
- Candidate locations, coordinates, evidence, traffic estimates, location scores

**Campaign data:**
- Budget, selected channels, generated creatives, simulation assumptions, campaign status

**Agent activity:**
- Research runs, agent messages, decisions, rejected recommendations, human approvals, model prompts and versions

### Recommended Tables

```
organizations
users
brands
products
campaigns
target_audiences
candidate_locations
location_signals
media_channels
creative_variants
simulations
agent_runs
agent_messages
approvals
```

### Why InsForge Needs to Be Visible

Demonstrate:

- User login
- Product image storage
- Campaign history
- Real-time agent status
- Persistent generated assets
- Saved approval trail
- Reopening an earlier campaign

This proves the product is an actual SaaS application rather than a scripted prototype.

---

## Location Scoring Model

Each candidate location receives an explicit score:

```
Location Score =
    25%  target-audience fit
  + 20%  estimated traffic
  + 15%  viewing quality
  + 15%  contextual relevance
  + 10%  competitor opportunity
  + 10%  cost efficiency
  +  5%  data confidence
```

Each category should show:

| Field | Description |
|---|---|
| Score | Numeric rating |
| Evidence | Supporting data points |
| Source | Where the data came from |
| Confidence | How reliable the data is |
| Missing information | Gaps in the analysis |

### Example

| Factor | Score | Evidence |
|---|---|---|
| Audience fit | 88 | Near university, gyms, and transit |
| Traffic | 82 | High weekday commuter activity |
| Context | 91 | Beverage and convenience retail nearby |
| Cost efficiency | 63 | Higher estimated placement cost |
| Data confidence | 74 | Some traffic data is modeled |

The exact weights should be configurable by campaign objective. For brand awareness, traffic may matter most. For a local restaurant, proximity and conversion radius may matter more.

---

## Simulation Layer

Present a **scenario simulator**, not a prediction engine.

### Inputs

- Estimated impressions
- Audience-fit percentage
- Visibility adjustment
- Creative-quality score
- Assumed response rate
- Assumed conversion rate
- Campaign duration
- Average transaction value
- Cost

### Outputs — Three Scenarios

| Scenario | Estimated Reach | Responses | Conversions |
|---|---|---|---|
| Conservative | 40,000 | 200 | 10 |
| Base | 60,000 | 480 | 29 |
| Optimistic | 80,000 | 880 | 62 |

Always expose assumptions. Do not claim precise predictions like "This campaign will generate 18,492 sales." The goal is to demonstrate that the system compares campaign options consistently and transparently.

---

## Demographic Targeting Guidelines

Use safe, non-discriminatory targeting attributes:

- Age bands (where appropriate)
- Household composition
- Daytime versus residential population
- Commuting patterns
- Language needs
- Consumer interests
- Retail category density
- Urban versus suburban environment
- Foot traffic
- Event attendance
- Tourism
- Proximity to relevant destinations

**Do not** use race or other protected traits for targeting. Even when aggregate demographic datasets are legally available, using protected traits can produce discriminatory outcomes, reputational risk, and restrictions in regulated categories.

For sensitive categories (employment, housing, lending, healthcare, politics), demographic targeting should be heavily restricted or excluded.

A **Fairness Agent** could strengthen the project by flagging recommendations that rely excessively on protected or proxy characteristics.
