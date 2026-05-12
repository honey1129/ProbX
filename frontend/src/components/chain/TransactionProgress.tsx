"use client";

import { CheckCircle2, Clock3, ExternalLink, Loader2, RadioTower, Signature, X, XCircle } from "lucide-react";
import { explorerUrlForSignature, shortSignature } from "@/lib/explorer";

export type TransactionStepState = "pending" | "active" | "complete" | "error";

export type TransactionProgressStep = {
  id: string;
  label: string;
  detail: string;
  state: TransactionStepState;
};

export type TransactionProgressPhase = "idle" | "signing" | "broadcasted" | "confirming" | "confirmed" | "timeout" | "error";

export type TransactionProgressState = {
  title: string;
  phase: TransactionProgressPhase;
  signature?: string;
  message?: string;
  error?: string;
};

type TransactionProgressProps = {
  state: TransactionProgressState | null;
  explorerCluster: string;
};

export function TransactionProgress({ state, explorerCluster }: TransactionProgressProps) {
  if (!state || state.phase === "idle") return null;

  const explorerUrl = state.signature ? explorerUrlForSignature(state.signature, explorerCluster) : null;
  const isError = state.phase === "error";
  const isTimeout = state.phase === "timeout";
  const isDone = state.phase === "confirmed";
  const steps = buildSteps(state);

  return (
    <section
      className={`rounded-lg border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${
        isError
          ? "border-no/35 bg-no/10"
          : isDone
            ? "border-yes/35 bg-yes/10"
            : "border-solBlue/35 bg-solBlue/10"
      }`}
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <ProgressIcon phase={state.phase} />
            <span>{state.title}</span>
          </div>
          <p className={`mt-1 text-xs ${isError ? "text-no" : isDone ? "text-yes" : "text-slate-300"}`}>
            {state.error || state.message || defaultMessage(state.phase)}
          </p>
        </div>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-solBlue/45 bg-black/25 px-2.5 text-xs font-black text-solBlue transition hover:border-solBlue hover:bg-solBlue/15"
          >
            Explorer
            <ExternalLink size={13} />
          </a>
        ) : null}
      </div>

      {state.signature ? (
        <div className="mt-3 rounded-md border border-white/10 bg-black/30 px-3 py-2">
          <div className="mb-1 text-[10px] font-bold uppercase text-muted">Transaction Signature</div>
          <code className="block break-all text-xs text-slate-200">{shortSignature(state.signature)}</code>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2">
        {steps.map((step) => (
          <ProgressStep key={step.id} step={step} dimmed={isTimeout && step.state !== "complete"} />
        ))}
      </div>
    </section>
  );
}

type TransactionProgressModalProps = TransactionProgressProps & {
  onClose: () => void;
};

export function TransactionProgressModal({ state, explorerCluster, onClose }: TransactionProgressModalProps) {
  if (!state || state.phase === "idle") return null;

  return (
    <div className="fixed inset-0 z-[13000] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={state.title}>
      <div className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-black/35 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-white">On-chain transaction</div>
            <div className="mt-0.5 truncate text-xs text-muted">{state.title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-black/30 text-muted transition hover:text-white"
            aria-label="Close transaction status"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4">
          <TransactionProgress state={state} explorerCluster={explorerCluster} />
        </div>
      </div>
    </div>
  );
}

function buildSteps(state: TransactionProgressState): TransactionProgressStep[] {
  const phase = state.phase;
  return [
    {
      id: "sign",
      label: "Wallet signature",
      detail: phase === "signing" ? "Waiting for wallet approval" : "Signed by wallet",
      state: phase === "signing" ? "active" : phase === "error" && !state.signature ? "error" : "complete"
    },
    {
      id: "broadcast",
      label: "Broadcast to Solana",
      detail: state.signature ? "Transaction hash received" : "Preparing transaction",
      state:
        phase === "broadcasted"
          ? "active"
          : state.signature && (phase === "confirming" || phase === "confirmed" || phase === "timeout")
            ? "complete"
            : phase === "error" && state.signature
              ? "error"
              : "pending"
    },
    {
      id: "index",
      label: "Confirm and index",
      detail:
        phase === "confirmed"
          ? "Indexed by ProbX"
          : phase === "timeout"
            ? "Still catching up"
            : "Waiting for confirmed event",
      state:
        phase === "confirmed"
          ? "complete"
          : phase === "timeout"
            ? "active"
            : phase === "confirming"
              ? "active"
              : phase === "error"
                ? "error"
                : "pending"
    }
  ];
}

function ProgressStep({ step, dimmed }: { step: TransactionProgressStep; dimmed?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-2 ${dimmed ? "opacity-80" : ""}`}>
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 bg-slate-950/80">
        {step.state === "complete" ? (
          <CheckCircle2 size={14} className="text-yes" />
        ) : step.state === "active" ? (
          <Loader2 size={14} className="animate-spin text-solBlue" />
        ) : step.state === "error" ? (
          <XCircle size={14} className="text-no" />
        ) : (
          <Clock3 size={14} className="text-muted" />
        )}
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs font-black text-slate-100">{step.label}</div>
        <div className="truncate text-[11px] text-muted">{step.detail}</div>
      </div>
    </div>
  );
}

function ProgressIcon({ phase }: { phase: TransactionProgressPhase }) {
  if (phase === "confirmed") return <CheckCircle2 size={16} className="text-yes" />;
  if (phase === "error") return <XCircle size={16} className="text-no" />;
  if (phase === "broadcasted" || phase === "confirming" || phase === "timeout") {
    return <RadioTower size={16} className={phase === "timeout" ? "text-solBlue" : "text-solBlue animate-pulse"} />;
  }
  return <Signature size={16} className="text-solBlue" />;
}

function defaultMessage(phase: TransactionProgressPhase) {
  if (phase === "signing") return "Confirm the transaction in your wallet.";
  if (phase === "broadcasted") return "Transaction sent to Solana.";
  if (phase === "confirming") return "Waiting for the ProbX indexer.";
  if (phase === "confirmed") return "Transaction confirmed and indexed.";
  if (phase === "timeout") return "Transaction was sent; the indexer is still catching up.";
  if (phase === "error") return "Transaction failed.";
  return "";
}
