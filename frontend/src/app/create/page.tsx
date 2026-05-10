"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { CalendarClock, CirclePlus, Droplets, FileQuestion, ImagePlus, Link2, Loader2, X } from "lucide-react";
import { MarketCard } from "@/components/market/MarketCard";
import { useMarkets } from "@/components/market/MarketProvider";
import type { Market } from "@/lib/types";

const categories: Market["category"][] = ["Crypto", "Politics", "Sports", "Tech", "Macro", "On-chain"];
const maxAvatarBytes = 240_000;
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

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Avatar file must be an image.");
      return;
    }
    if (file.size > maxAvatarBytes) {
      setStatus("Avatar image is too large. Please use an image under 240 KB.");
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setAvatarUrl(dataUrl);
      setStatus(null);
    } catch {
      setStatus("Could not read avatar image.");
    }
  }

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
            <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 rounded-lg border border-line bg-black/25 p-4">
              <div className="grid place-items-center rounded-lg border border-line bg-slate-950/70 p-2">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="h-20 w-20 rounded-lg object-cover" />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-solPurple/35 bg-solPurple/10 text-solPurple">
                    <ImagePlus size={24} />
                  </div>
                )}
              </div>
              <div className="grid min-w-0 gap-3">
                <div className="flex gap-2">
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-solPurple/45 bg-solPurple/15 px-3 text-sm font-black text-violet-100 transition hover:bg-solPurple/25">
                    <ImagePlus size={15} /> Upload
                    <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                  </label>
                  {avatarUrl ? (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl("")}
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-bold text-muted transition hover:border-no/45 hover:text-no"
                    >
                      <X size={15} /> Remove
                    </button>
                  ) : null}
                </div>
                <label className="flex h-11 min-w-0 items-center gap-2 rounded-lg border border-line bg-black/35 px-3">
                  <Link2 size={15} className="shrink-0 text-muted" />
                  <input
                    value={avatarUrl}
                    onChange={(event) => setAvatarUrl(event.target.value)}
                    className="h-full min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-muted"
                    placeholder="https://... or uploaded image data"
                  />
                </label>
                <p className="text-xs text-muted">Use a square image under 240 KB, or paste a hosted image URL.</p>
              </div>
            </div>
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
