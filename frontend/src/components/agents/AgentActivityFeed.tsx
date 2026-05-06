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

  return (
    <div className="grid gap-2">
      {activity.map((item) => {
        const market = markets.find((m) => m.id === item.marketId);
        const age = now ? `${Math.max(1, Math.round((now - item.timestamp) / 1000))}s ago` : "live";
        return (
          <article key={item.id} className="grid grid-cols-[40px_1fr] gap-3 rounded-lg border border-line bg-slate-950/55 p-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-solPurple/40 bg-solPurple/15 text-xs font-black">
              {item.agent.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <b>{item.agent}</b>
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
                <div className="h-full bg-gradient-to-r from-solBlue to-yes" style={{ width: `${item.confidence}%` }} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
