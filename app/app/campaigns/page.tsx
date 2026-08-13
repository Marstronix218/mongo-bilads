import Link from "next/link";
import type { CampaignRecord } from "@/lib/types";
import { campaignToApi, listCampaigns } from "@/lib/campaigns";
import CampaignList from "./CampaignList";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = (await listCampaigns()).map(campaignToApi) as CampaignRecord[];

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-bilads-accent">Local system of record</p>
            <h1 className="mt-2 text-4xl font-bold">Saved campaigns</h1>
          </div>
          <Link href="/" className="rounded border border-bilads-fg/15 px-4 py-2 text-sm">New campaign</Link>
        </div>
        <CampaignList campaigns={campaigns} />
      </div>
    </main>
  );
}
