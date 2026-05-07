"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Link2, Send, Share2, X } from "lucide-react";
import { formatPercent, formatSol, formatUsd, probability, timeRemaining } from "@/lib/format";
import type { Market } from "@/lib/types";

type MarketShareDialogProps = {
  market: Market | null | undefined;
  open: boolean;
  url: string;
  onClose: () => void;
};

type CopyState = "idle" | "copied" | "failed";

export function MarketShareDialog({ market, open, url, onClose }: MarketShareDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    setCopyState("idle");

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const sharePayload = useMemo(() => {
    if (!market) return null;

    const yesProbability = probability(market);
    const noProbability = 1 - yesProbability;
    const leadingSide = yesProbability >= noProbability ? "YES" : "NO";
    const leadingProbability = leadingSide === "YES" ? yesProbability : noProbability;
    const title = `${market.question} | ProbX`;
    const text = [
      `I am watching this ProbX prediction market:`,
      `"${market.question}"`,
      ``,
      `${leadingSide} is leading at ${formatPercent(leadingProbability, 0)}.`,
      `24h volume: ${formatUsd(market.volume24h)}.`,
      `Liquidity: ${formatSol(market.totalLiquidity)}.`,
      `Ends in: ${timeRemaining(market.endTime)}.`,
      ``,
      `Trade your view on ProbX: ${url}`
    ].join("\n");
    const shortText = `${market.question}\n\n${leadingSide} leading at ${formatPercent(leadingProbability, 0)} on ProbX.\n${url}`;

    return {
      title,
      text,
      shortText,
      leadingSide,
      leadingProbability,
      yesProbability,
      noProbability
    };
  }, [market, url]);

  const copyText = useCallback(async () => {
    if (!sharePayload) return;
    try {
      await navigator.clipboard.writeText(sharePayload.text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  }, [sharePayload]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 1800);
  }, [url]);

  const nativeShare = useCallback(async () => {
    if (!sharePayload) return;
    if (!navigator.share) {
      await copyText();
      return;
    }

    try {
      await navigator.share({
        title: sharePayload.title,
        text: sharePayload.shortText,
        url
      });
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("idle");
    }
  }, [copyText, sharePayload, url]);

  if (!mounted || !open || !market || !sharePayload) return null;

  const encodedText = encodeURIComponent(sharePayload.shortText);
  const encodedUrl = encodeURIComponent(url);
  const xShareUrl = `https://twitter.com/intent/tweet?text=${encodedText}`;
  const telegramShareUrl = `https://t.me/share/url?url=${encodedUrl}&text=${encodeURIComponent(sharePayload.shortText.replace(url, "").trim())}`;

  return createPortal(
    <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Share market">
      <button className="absolute inset-0 cursor-default" aria-label="Close share dialog" onClick={onClose} />
      <section className="relative w-full max-w-[560px] overflow-hidden rounded-lg border border-solBlue/30 bg-slate-950 shadow-[0_24px_80px_rgba(0,0,0,0.58)]">
        <div className="border-b border-line bg-[radial-gradient(circle_at_20%_0%,rgba(49,185,255,0.20),transparent_34%),linear-gradient(135deg,rgba(155,92,255,0.22),rgba(3,6,9,0.90))] p-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-solBlue">Share Market</p>
              <h2 className="mt-2 text-xl font-black leading-tight text-white">{market.question}</h2>
            </div>
            <button
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/25 text-slate-300 transition hover:border-white/25 hover:text-white"
              aria-label="Close share dialog"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <ShareMetric label="Leading" value={`${sharePayload.leadingSide} ${formatPercent(sharePayload.leadingProbability, 0)}`} tone={sharePayload.leadingSide === "YES" ? "yes" : "no"} />
            <ShareMetric label="Volume" value={formatUsd(market.volume24h)} />
            <ShareMetric label="Liquidity" value={formatSol(market.totalLiquidity, 1)} />
          </div>
        </div>

        <div className="p-5">
          <div className="rounded-lg border border-line bg-black/35 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-muted">Generated Message</span>
              <span className="text-xs text-muted">{sharePayload.text.length} chars</span>
            </div>
            <pre className="max-h-48 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-slate-200">{sharePayload.text}</pre>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <a
              href={xShareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-slate-900/80 px-3 text-sm font-black text-slate-100 transition hover:border-solBlue/55 hover:bg-solBlue/10"
            >
              <XIcon size={15} /> Share to X
            </a>
            <a
              href={telegramShareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-line bg-slate-900/80 px-3 text-sm font-black text-slate-100 transition hover:border-solBlue/55 hover:bg-solBlue/10"
            >
              <Send size={15} /> Telegram
            </a>
            <button
              onClick={nativeShare}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-solPurple/40 bg-solPurple/15 px-3 text-sm font-black text-white transition hover:bg-solPurple/25"
            >
              <Share2 size={15} /> System Share
            </button>
            <button
              onClick={copyText}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-yes/35 bg-yes/10 px-3 text-sm font-black text-yes transition hover:bg-yes/15"
            >
              {copyState === "copied" ? <Check size={15} /> : <Copy size={15} />} {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy Text"}
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-black/25 p-2">
            <div className="min-w-0 flex-1 truncate px-2 text-xs text-muted">{url}</div>
            <button
              onClick={copyLink}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-black text-slate-200 transition hover:border-solBlue/45 hover:text-white"
            >
              <Link2 size={13} /> Link
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-slate-300 transition hover:border-solBlue/45 hover:text-white"
              aria-label="Open market link"
            >
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

function ShareMetric({ label, value, tone }: { label: string; value: string; tone?: "yes" | "no" }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
      <div className="truncate text-[11px] uppercase text-muted">{label}</div>
      <div className={`mt-1 truncate text-sm font-black ${tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-white"}`}>{value}</div>
    </div>
  );
}

function XIcon({ size = 16 }: { size?: string | number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.53 3h3.12l-6.82 7.8L21.85 21h-6.28l-4.92-6.43L5.02 21H1.9l7.29-8.34L1.5 3h6.44l4.45 5.88L17.53 3Zm-1.1 16.2h1.73L7 4.71H5.14L16.43 19.2Z"
      />
    </svg>
  );
}
