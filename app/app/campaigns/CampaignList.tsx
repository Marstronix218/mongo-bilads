"use client";

import { useRouter } from "next/navigation";
import type { CampaignRecord } from "@/lib/types";

export default function CampaignList({ campaigns }: { campaigns: CampaignRecord[] }) {
  const router = useRouter();

  function reopen(campaign: CampaignRecord) {
    sessionStorage.setItem("bilads-brief", JSON.stringify({
      brief: campaign.brief,
      campaign: campaign.campaign,
      campaignId: campaign.id,
      research: campaign.research,
      clientRequestId: crypto.randomUUID(),
      researchRequestId: crypto.randomUUID(),
    }));
    router.push("/results");
  }

  if (campaigns.length === 0) {
    return <p className="mt-10 text-bilads-fg/50">No saved campaigns yet.</p>;
  }

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      {campaigns.map((campaign) => (
        <article key={campaign.id} className="rounded-xl border border-bilads-fg/10 bg-bilads-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">{campaign.brief.productName}</h2>
              <p className="mt-1 text-xs font-mono uppercase text-bilads-accent">{campaign.status}</p>
            </div>
            <span className="text-xs text-bilads-fg/35">
              {new Date(campaign.updatedAt).toLocaleDateString()}
            </span>
          </div>
          <p className="mt-4 line-clamp-2 text-sm text-bilads-fg/60">{campaign.brief.description || "No description"}</p>
          <p className="mt-4 text-xs font-mono text-bilads-fg/40">
            ${campaign.campaign.weeklyBudgetUsd.toLocaleString()}/week · {campaign.campaign.campaignWeeks} weeks
          </p>
          <button
            onClick={() => reopen(campaign)}
            disabled={!campaign.research}
            className="mt-5 rounded bg-bilads-accent px-4 py-2 text-sm font-bold text-bilads-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {campaign.research ? "Reopen campaign" : "Research pending"}
          </button>
        </article>
      ))}
    </div>
  );
}
