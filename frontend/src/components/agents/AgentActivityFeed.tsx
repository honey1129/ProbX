"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@/lib/format";
import type { AgentActivity, Market } from "@/lib/types";

export function AgentActivityFeed({ activity, markets }: { activity: AgentActivity[]; markets: Market[] }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!activity.length) {
    return (
      <div className="grid h-40 place-items-center rounded-lg border border-line bg-black/25 p-5 text-center">
        <div>
          <p className="font-bold text-slate-200">No matching activity</p>
          <p className="mt-1 text-sm text-muted">Recorded trades will appear here after activity is indexed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="scroll-surface grid h-full content-start gap-2 overflow-y-auto pr-0.5">
      {activity.map((item, index) => {
        const market = markets.find((m) => m.id === item.marketId);
        const age = now ? `${Math.max(1, Math.round((now - item.timestamp) / 1000))}s ago` : "now";
        return (
          <article key={item.id} className="grid grid-cols-[42px_1fr] gap-3 rounded-lg border border-line bg-slate-950/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
            <AgentAvatar index={index} />
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <b className="text-slate-100">{item.agent}</b>
                <span className="text-xs text-muted">{age}</span>
              </div>
              <span className={item.side === "YES" ? "agent-tag yes" : "agent-tag no"}>
                {item.action} {item.side}
              </span>
              <p className="truncate text-xs text-muted">{market?.question ?? "Unknown market"}</p>
              <div className="mt-1 flex items-center justify-between text-xs">
                <span>{formatUsd(item.size)}</span>
                <span className="text-slate-300">Confidence {item.confidence}%</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-gradient-to-r from-solBlue via-solPurple to-yes" style={{ width: `${item.confidence}%` }} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AgentAvatar({ index }: { index: number }) {
  return (
    <div className={`agent-avatar tone-${(index % 5) + 1}`} aria-hidden="true">
      <span className="agent-face">
        <i />
        <i />
        <b />
      </span>
    </div>
  );
}
