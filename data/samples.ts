import type { SampleProduct } from "../types";

// Three prewritten sample briefs. Clicking a sample card on the landing page
// sets form state to { ...sample.brief, ...sample.campaign } and previews
// productImagePath in the image drop zone. (§7.5)
//
// Product images are pre-generated and committed to /public/samples/.
// Campaign defaults are tuned so each sample lands 3 in-budget boards AND
// produces a distinct top-3 across the awareness↔targeted slider (see the
// data/README notes and scripts/check-demomatch.mjs).

export const SAMPLES: SampleProduct[] = [
  {
    id: "volt",
    label: "Volt E-Bikes",
    brief: {
      productName: "Volt",
      description:
        "A premium electric commuter bike for getting across the city without a car. Long range, app-unlock, and a lightweight frame built for daily riders who care about the planet and hate parking.",
      audience:
        "Car-free and car-light San Franciscans, 25-40, who commute, work out, and want an eco-friendly way to move around the city.",
    },
    campaign: {
      weeklyBudgetUsd: 3000,
      campaignWeeks: 4,
      awarenessWeight: 0.7,
    },
    productImagePath: "/samples/volt.png",
  },
  {
    id: "fog-city",
    label: "Fog City Coffee",
    brief: {
      productName: "Fog City Coffee",
      description:
        "A neighborhood micro-roaster and cafe pouring single-origin espresso and cold brew. Slow mornings, late-night pour-overs, and a rotating wall of local artists.",
      audience:
        "Neighborhood creatives, freelancers, and foodies who walk to their coffee and care about where the beans come from.",
    },
    campaign: {
      weeklyBudgetUsd: 2200,
      campaignWeeks: 4,
      awarenessWeight: 0.35,
    },
    productImagePath: "/samples/fog-city.png",
  },
  {
    id: "ledgerly",
    label: "Ledgerly",
    brief: {
      productName: "Ledgerly",
      description:
        "Accounting software built for startups. Automated books, real-time runway, and one dashboard your whole finance team can trust. Close the month in a day, not a week.",
      audience:
        "Founders, operators, and finance leads at San Francisco startups and small tech companies who are tired of spreadsheets.",
    },
    campaign: {
      weeklyBudgetUsd: 3500,
      campaignWeeks: 6,
      awarenessWeight: 0.5,
    },
    productImagePath: "/samples/ledgerly.png",
  },
];
