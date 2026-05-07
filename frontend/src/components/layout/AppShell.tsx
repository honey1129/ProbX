"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CirclePlus, Layers3, WalletCards } from "lucide-react";
import { WalletConnect } from "@/components/WalletConnect";
import { useMarkets } from "@/components/market/MarketProvider";
import { formatPercent, probability } from "@/lib/format";

const tabs = [
  { href: "/", label: "Markets", icon: Layers3 },
  { href: "/portfolio", label: "Portfolio", icon: WalletCards },
  { href: "/create", label: "Create", icon: CirclePlus },
  { href: "/agents", label: "Agents", icon: Bot }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-screen overflow-hidden bg-canvas text-slate-100">
      <header className="h-[60px] border-b border-line bg-black/80 backdrop-blur-xl">
        <div className="mx-auto grid h-full max-w-[1720px] grid-cols-[250px_1fr_auto] items-center px-5">
          <Link href="/" className="flex w-max items-center gap-3">
            <span className="probx-logo-mark" aria-hidden="true">
              <span className="probx-logo-slice slice-a" />
              <span className="probx-logo-slice slice-b" />
              <span className="probx-logo-slice slice-c" />
              <span className="probx-logo-slice slice-d" />
            </span>
            <span className="text-[27px] font-black tracking-tight">ProbX</span>
          </Link>

          <nav className="flex justify-center gap-7">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = tab.href === "/" ? pathname === "/" || pathname.startsWith("/markets") : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`group flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm transition ${
                    active
                      ? "border-solPurple/70 bg-solPurple/20 text-white shadow-glow"
                      : "border-transparent text-slate-300 hover:border-solPurple/60 hover:bg-solPurple/15 hover:text-white hover:shadow-glow"
                  }`}
                >
                  <Icon size={16} className={active ? "text-white" : "text-violet-300"} />
                  {tab.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden h-10 items-center gap-2 rounded-lg border border-line bg-slate-950/70 px-4 text-sm text-slate-200 lg:flex">
              <span className="h-2 w-2 rounded-full bg-yes shadow-[0_0_14px_#19f58c]" />
              Solana Mainnet
            </div>
            <WalletConnect />
          </div>
        </div>
      </header>
      <main className="mx-auto h-[calc(100vh-104px)] max-w-[1720px] overflow-x-hidden overflow-y-auto px-2.5 py-2.5 pb-16">{children}</main>
      <footer className="fixed bottom-2.5 left-2.5 right-2.5 z-40 hidden overflow-hidden rounded-lg border border-solBlue/25 bg-slate-950/90 shadow-[0_0_28px_rgba(49,185,255,0.10)] backdrop-blur-xl xl:block">
        <Ticker />
      </footer>
    </div>
  );
}

function Ticker() {
  const { markets } = useMarkets();
  const items = markets.slice(0, 6).map((market) => {
    const yes = probability(market);
    const side = yes >= 0.5 ? "YES" : "NO";
    const displayProbability = side === "YES" ? yes : 1 - yes;
    return {
      id: market.id,
      market: market.question,
      side,
      probability: formatPercent(displayProbability, 0),
      change: `${market.change24h >= 0 ? "+" : "-"}${Math.abs(market.change24h * 100).toFixed(1)}%`
    };
  });

  return (
    <div className="flex h-10 items-center overflow-hidden text-xs">
      <div className="flex h-full shrink-0 items-center gap-2 border-r border-line px-4 text-slate-300">
        <span className="h-2 w-2 rounded-full bg-yes shadow-[0_0_12px_#19f58c]" />
        Market Ticker
      </div>
      <div className="ticker-shell min-w-0 flex-1">
        <div className="ticker-track">
          {[0, 1].map((group) => (
            <div key={group} className="ticker-group">
              {items.map((item) => (
                <Link key={`${group}-${item.id}`} href={`/markets/${item.id}`} className="ticker-item">
                  <span className="max-w-[190px] truncate text-slate-300">{item.market}</span>
                  <b className={item.side === "YES" ? "text-yes" : "text-no"}>
                    {item.side} {item.probability}
                  </b>
                  <span className={item.change.startsWith("+") ? "text-yes" : "text-no"}>
                    {item.change.startsWith("+") ? "▲" : "▼"} {item.change.replace("+", "").replace("-", "")}
                  </span>
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <Link href="/markets" className="flex h-full shrink-0 items-center px-5 text-slate-300 transition hover:text-white">
        View All
      </Link>
    </div>
  );
}
