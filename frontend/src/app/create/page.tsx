"use client";

import { FormEvent, useMemo, useState } from "react";
import { CalendarClock, CirclePlus, Droplets, FileQuestion, ImagePlus, Loader2 } from "lucide-react";
import { MarketCard } from "@/components/market/MarketCard";
import { MarketMediaPicker } from "@/components/market/MarketMediaPicker";
import { useMarkets } from "@/components/market/MarketProvider";
import type { Market } from "@/lib/types";

const categories: Market["category"][] = ["Crypto", "Politics", "Sports", "Tech", "Macro", "On-chain"];
const maxAvatarPayloadLength = 360_000;

export default function CreateMarketPage() {
  const { createMarket, waitForActionConfirmation, backendEnabled, isLoading, error, refresh } = useMarkets();
  const [question, setQuestion] = useState("Will SOL close above $200 this month?");
  const [category, setCategory] = useState<Market["category"]>("Crypto");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [endTime, setEndTime] = useState(defaultDateTimeLocal());
  const [initialLiquidity, setInitialLiquidity] = useState("1");
  const [status, setStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const preview = useMemo<Market>(() => {
    const liquidity = Math.max(0.01, Number(initialLiquidity) || 1);
    return {
      id: "preview",
      publicKey: "11111111111111111111111111111111",
      creator: "preview",
      resolver: "preview",
      protocolConfig: "local",
      treasury: "preview",
      protocolFeeBps: 100,
      creatorLpShares: liquidity,
      protocolFees: 0,
      residualWithdrawn: 0,
      residualClaimed: false,
      endTime: Math.floor(new Date(endTime).getTime() / 1000),
      question: question.trim() || "Market question preview",
      category,
      avatarUrl: avatarUrl.trim() || undefined,
      yesPool: liquidity,
      noPool: liquidity,
      totalLiquidity: liquidity,
      volume24h: 0,
      participants: 1,
      change24h: 0,
      probabilityHistory: Array.from({ length: 72 }, () => 0.5)
    };
  }, [avatarUrl, category, endTime, initialLiquidity, question]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);

    const trimmed = question.trim();
    const unixEndTime = Math.floor(new Date(endTime).getTime() / 1000);
    if (!trimmed) {
      setStatus("Question is required.");
      return;
    }
    if (!Number.isFinite(unixEndTime) || unixEndTime <= Math.floor(Date.now() / 1000)) {
      setStatus("End time must be in the future.");
      return;
    }
    if (avatarUrl.trim().length > maxAvatarPayloadLength) {
      setStatus("Avatar image payload is too large.");
      return;
    }

    setIsSubmitting(true);
    try {
      const signature = await createMarket(trimmed, unixEndTime, {
        category,
        initialLiquidity: Number(initialLiquidity) || 1000,
        avatarUrl: avatarUrl.trim() || undefined
      });
      if (signature !== "local" && signature !== "indexed") {
        setStatus(`Create transaction sent: ${signature.slice(0, 12)}... waiting for indexer.`);
        const confirmation = await waitForActionConfirmation(signature, { eventType: "MarketCreated" });
        setStatus(
          confirmation === "confirmed"
            ? `Market confirmed and indexed: ${signature.slice(0, 12)}...`
            : confirmation === "timeout"
              ? `Create transaction sent: ${signature.slice(0, 12)}... indexer still catching up.`
              : "Market saved to ProbX API."
        );
        return;
      }
      setStatus(
        signature === "local"
          ? "Market created in local preview."
          : "Market saved to ProbX API."
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Create market failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_clamp(360px,29vw,470px)] xl:overflow-hidden">
      <main className="terminal-panel flex h-full min-h-0 flex-col overflow-hidden p-5">
        <div className="mb-6 flex items-center justify-between border-b border-line pb-4">
          <div>
            <h1 className="text-3xl font-black">Create Market</h1>
            <p className="mt-1 text-sm text-muted">
              {backendEnabled ? "Create a YES/NO market through the ProbX API." : "Create a YES/NO market in the local preview workspace."}
            </p>
          </div>
          <span className="rounded-lg border border-solPurple/50 bg-solPurple/15 px-3 py-2 text-xs font-black text-violet-200 shadow-glow">
            {backendEnabled ? "API listing" : "Local preview"}
          </span>
        </div>

        {error ? (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-no/30 bg-no/10 px-4 py-3 text-sm text-no">
            <span className="min-w-0 truncate">ProbX API error: {error}</span>
            <button onClick={refresh} className="shrink-0 font-black text-slate-100 transition hover:text-white" type="button">
              Retry
            </button>
          </div>
        ) : null}

        <form onSubmit={submit} className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto pr-1">
          <label className="grid gap-2">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <FileQuestion size={16} className="text-solBlue" /> Question
            </span>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
              maxLength={180}
              className="rounded-lg border border-line bg-black/35 p-4 text-lg font-bold outline-none transition placeholder:text-muted focus:border-solBlue/70 focus:shadow-[0_0_26px_rgba(49,185,255,0.12)]"
              placeholder="Will ETH trade above $5,000 before July 1?"
            />
            <span className="text-right text-xs text-muted">{question.length}/180</span>
          </label>

          <div className="grid gap-2">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <ImagePlus size={16} className="text-solPurple" /> Avatar
            </span>
            <MarketMediaPicker value={avatarUrl} onChange={setAvatarUrl} />
          </div>

          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-3">
            <label className="grid gap-2">
              <span className="text-sm font-bold text-slate-200">Category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as Market["category"])}
                className="h-12 rounded-lg border border-line bg-black/35 px-3 font-bold outline-none focus:border-solPurple/70"
              >
                {categories.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <CalendarClock size={16} className="text-solBlue" /> End Time
              </span>
              <input
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
                type="datetime-local"
                className="h-12 rounded-lg border border-line bg-black/35 px-3 font-bold outline-none focus:border-solBlue/70"
              />
            </label>

            <label className="grid gap-2">
              <span className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <Droplets size={16} className="text-yes" /> Initial Liquidity
              </span>
              <div className="flex h-12 items-center rounded-lg border border-line bg-black/35 px-3">
                <input
                  value={initialLiquidity}
                  onChange={(event) => setInitialLiquidity(event.target.value)}
                  inputMode="decimal"
                  className="h-full min-w-0 flex-1 bg-transparent font-bold outline-none"
                />
                <span className="text-sm font-black text-muted">SOL</span>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-black/25 p-4 2xl:grid-cols-3">
            <ChecklistItem label="Binary YES/NO market" />
            <ChecklistItem label="Creator becomes resolver" />
            <ChecklistItem label="Pool uses native SOL" />
          </div>

          <button
            disabled={isSubmitting || (backendEnabled && isLoading)}
            className="primary-action yes flex items-center justify-center gap-2"
            type="submit"
          >
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <CirclePlus size={18} />}
            {isSubmitting ? "Creating..." : backendEnabled && isLoading ? "Waiting for API..." : "Create Market"}
          </button>
          {status ? <p className="rounded-lg border border-line bg-black/25 p-3 text-sm text-slate-300">{status}</p> : null}
        </form>
      </main>

      <aside className="h-full min-h-0">
        <section className="terminal-panel h-full overflow-y-auto p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-black">Market Preview</h2>
            <span className="rounded border border-yes/25 bg-yes/10 px-2 py-1 text-xs text-yes">50/50</span>
          </div>
          <MarketCard market={preview} />
          <div className="mt-4 rounded-lg border border-line bg-slate-950/45 p-3 text-sm text-muted">
            The on-chain AMM uses <code>initial_liquidity</code> to seed balanced YES/NO price weights.
          </div>
        </section>
      </aside>
    </div>
  );
}

function ChecklistItem({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
      <span className="h-2 w-2 rounded-full bg-yes shadow-[0_0_14px_#19f58c]" />
      {label}
    </div>
  );
}

function defaultDateTimeLocal() {
  const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
