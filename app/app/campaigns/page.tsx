import Link from "next/link";
import type { CampaignRecord } from "@/lib/types";
import { campaignToApi, listCampaigns } from "@/lib/campaigns";
import { insforgeAdminConfigured } from "@/lib/insforge";
import CampaignList from "./CampaignList";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  let campaigns: CampaignRecord[] = [];
  let notice: string | null = null;
  if (insforgeAdminConfigured()) {
    campaigns = (await listCampaigns()).map(campaignToApi) as CampaignRecord[];
  } else {
    notice = "InsForge is not configured — campaigns are not being persisted.";
  }

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.2em] text-bilads-accent">InsForge system of record</p>
            <h1 className="mt-2 text-4xl font-bold">Saved campaigns</h1>
          </div>
          <Link href="/" className="rounded border border-bilads-fg/15 px-4 py-2 text-sm">New campaign</Link>
        </div>
        {notice ? <p className="mt-10 text-bilads-fg/50">{notice}</p> : <CampaignList campaigns={campaigns} />}
      </div>
    </main>
  );
}
