"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ProductBrief, CampaignParams } from "@/lib/types";
import { SAMPLES } from "@/lib/samples";

export default function Home() {
  const router = useRouter();

  const [brief, setBrief] = useState<ProductBrief>({
    productName: "",
    description: "",
    audience: "",
  });

  const [campaign, setCampaign] = useState<CampaignParams>({
    weeklyBudgetUsd: 3000,
    campaignWeeks: 4,
    awarenessWeight: 0.5,
  });

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [siteUrl, setSiteUrl] = useState("");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error">("idle");
  const [scanError, setScanError] = useState("");

  // URL → brief + ICP: scan a company homepage and prefill the form.
  const handleScan = useCallback(async () => {
    if (!siteUrl.trim() || scanState === "scanning") return;
    setScanState("scanning");
    setScanError("");
    try {
      const res = await fetch("/api/onboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: siteUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "scan failed");
      setBrief((b) => ({ ...b, ...data.brief }));
      setScanState("idle");
    } catch (e) {
      setScanState("error");
      setScanError(e instanceof Error ? e.message : "scan failed");
    }
  }, [siteUrl, scanState]);

  const handleImageDrop = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setImagePreview(result);
        setBrief((b) => ({ ...b, imageBase64: result }));
      };
      reader.readAsDataURL(file);
    },
    []
  );

  const prefillSample = useCallback(
    (sampleId: string) => {
      const sample = SAMPLES.find((s) => s.id === sampleId);
      if (!sample) return;
      setBrief(sample.brief);
      setCampaign(sample.campaign);
      setImagePreview(sample.productImagePath);
    },
    []
  );

  const handleDeploy = useCallback(async () => {
    if (!brief.productName.trim()) return;
    setLoading(true);
    // Store form state in sessionStorage for the results page
    sessionStorage.setItem(
      "bilads-brief",
      JSON.stringify({
        brief,
        campaign,
        clientRequestId: crypto.randomUUID(),
        researchRequestId: crypto.randomUUID(),
      })
    );
    router.push("/results");
  }, [brief, campaign, router]);

  return (
    <main className="min-h-screen flex flex-col items-center px-6 py-16">
      {/* Wordmark + tagline */}
      <div className="text-center mb-16">
        <h1 className="text-7xl md:text-9xl font-bold tracking-tighter text-bilads-fg">
          BILADS
        </h1>
        <p className="mt-4 text-xl md:text-2xl text-bilads-fg/70 font-mono">
          Billboards, decided.
        </p>
        <div className="mt-5 flex justify-center gap-4 text-sm">
          <Link href="/campaigns" className="text-bilads-accent hover:underline">Saved campaigns</Link>
        </div>
      </div>

      {/* Upload form */}
      <div className="w-full max-w-2xl space-y-6">
        {/* URL → brief + ICP scan */}
        <div>
          <div className="flex gap-3">
            <input
              type="url"
              placeholder="Paste your website — we'll write the brief"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
              className="flex-1 bg-bilads-surface border border-bilads-fg/10 rounded-lg px-4 py-3 text-bilads-fg placeholder:text-bilads-fg/30 focus:outline-none focus:border-bilads-accent/50 font-mono text-sm"
            />
            <button
              onClick={handleScan}
              disabled={!siteUrl.trim() || scanState === "scanning"}
              className="bg-bilads-accent text-bilads-bg font-bold text-sm px-5 rounded-lg hover:bg-bilads-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {scanState === "scanning" ? "Scanning…" : "Scan site"}
            </button>
          </div>
          {scanState === "scanning" && (
            <p className="mt-2 text-xs font-mono text-bilads-accent animate-pulse">
              Reading the homepage → inferring product + ideal customer profile…
            </p>
          )}
          {scanState === "error" && (
            <p className="mt-2 text-xs font-mono text-red-400">{scanError}</p>
          )}
        </div>

        {/* Image drop zone */}
        <label className="block border-2 border-dashed border-bilads-fg/20 rounded-lg p-8 text-center cursor-pointer hover:border-bilads-accent/50 transition-colors">
          {imagePreview ? (
            <img
              src={imagePreview}
              alt="Product"
              className="mx-auto max-h-40 object-contain"
            />
          ) : (
            <div className="text-bilads-fg/40">
              <p className="text-lg">Drop your product image here</p>
              <p className="text-sm mt-1">or click to browse</p>
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleImageDrop}
            className="hidden"
          />
        </label>

        {/* Text inputs */}
        <div className="grid gap-4">
          <input
            type="text"
            placeholder="Product name"
            value={brief.productName}
            onChange={(e) =>
              setBrief((b) => ({ ...b, productName: e.target.value }))
            }
            className="w-full bg-bilads-surface border border-bilads-fg/10 rounded-lg px-4 py-3 text-bilads-fg placeholder:text-bilads-fg/30 focus:outline-none focus:border-bilads-accent/50"
          />
          <textarea
            placeholder="Product description"
            value={brief.description}
            onChange={(e) =>
              setBrief((b) => ({ ...b, description: e.target.value }))
            }
            rows={3}
            className="w-full bg-bilads-surface border border-bilads-fg/10 rounded-lg px-4 py-3 text-bilads-fg placeholder:text-bilads-fg/30 focus:outline-none focus:border-bilads-accent/50 resize-none"
          />
          <input
            type="text"
            placeholder="Target audience"
            value={brief.audience}
            onChange={(e) =>
              setBrief((b) => ({ ...b, audience: e.target.value }))
            }
            className="w-full bg-bilads-surface border border-bilads-fg/10 rounded-lg px-4 py-3 text-bilads-fg placeholder:text-bilads-fg/30 focus:outline-none focus:border-bilads-accent/50"
          />
        </div>

        {/* Campaign params row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-bilads-fg/50 mb-1 font-mono">
              Weekly budget ($)
            </label>
            <input
              type="number"
              min={0}
              value={campaign.weeklyBudgetUsd}
              onChange={(e) =>
                setCampaign((c) => ({
                  ...c,
                  weeklyBudgetUsd: Number(e.target.value),
                }))
              }
              className="w-full bg-bilads-surface border border-bilads-fg/10 rounded-lg px-4 py-3 text-bilads-fg focus:outline-none focus:border-bilads-accent/50"
            />
          </div>
          <div>
            <label className="block text-sm text-bilads-fg/50 mb-1 font-mono">
              Campaign duration (weeks)
            </label>
            <input
              type="number"
              min={1}
              max={52}
              value={campaign.campaignWeeks}
              onChange={(e) =>
                setCampaign((c) => ({
                  ...c,
                  campaignWeeks: Number(e.target.value),
                }))
              }
              className="w-full bg-bilads-surface border border-bilads-fg/10 rounded-lg px-4 py-3 text-bilads-fg focus:outline-none focus:border-bilads-accent/50"
            />
          </div>
        </div>

        {/* Awareness <-> Targeted slider */}
        <div>
          <div className="flex justify-between text-sm text-bilads-fg/50 mb-2 font-mono">
            <span>Targeted</span>
            <span>Awareness</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={campaign.awarenessWeight}
            onChange={(e) =>
              setCampaign((c) => ({
                ...c,
                awarenessWeight: Number(e.target.value),
              }))
            }
            className="w-full accent-bilads-accent"
          />
        </div>

        {/* Deploy CTA */}
        <button
          onClick={handleDeploy}
          disabled={!brief.productName.trim() || loading}
          className="w-full bg-bilads-accent text-bilads-bg font-bold text-lg py-4 rounded-lg hover:bg-bilads-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? "Deploying..." : "Deploy agent team"}
        </button>

        {/* Divider */}
        <div className="border-t border-bilads-fg/10 my-8" />

        {/* Sample product cards */}
        <div>
          <p className="text-sm text-bilads-fg/40 mb-4 font-mono text-center">
            Or try a sample product
          </p>
          <div className="grid grid-cols-3 gap-4">
            {SAMPLES.map((sample) => (
              <button
                key={sample.id}
                onClick={() => prefillSample(sample.id)}
                className="bg-bilads-surface border border-bilads-fg/10 rounded-lg p-4 text-left hover:border-bilads-accent/50 transition-colors group"
              >
                <div className="w-full h-20 bg-bilads-bg/50 rounded mb-3 flex items-center justify-center overflow-hidden">
                  <img
                    src={sample.productImagePath}
                    alt={sample.label}
                    className="max-h-16 object-contain opacity-60 group-hover:opacity-100 transition-opacity"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </div>
                <p className="font-bold text-sm">{sample.label}</p>
                <p className="text-xs text-bilads-fg/40 mt-1 line-clamp-2">
                  {sample.brief.description}
                </p>
                <p className="text-xs text-bilads-accent mt-2 font-mono">
                  ${sample.campaign.weeklyBudgetUsd}/wk
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Voyagent: seller-facing cockpit (board owner → ranked advertisers) */}
        <p className="text-center pt-10">
          <a
            href="/map"
            className="font-mono text-xs text-bilads-fg/25 hover:text-bilads-fg/60 transition-colors"
          >
            Voyagent cockpit →
          </a>
        </p>
      </div>
    </main>
  );
}
