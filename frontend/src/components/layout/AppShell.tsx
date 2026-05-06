import Link from "next/link";
import { Bot, CirclePlus, Layers3, WalletCards } from "lucide-react";
import { WalletConnect } from "@/components/WalletConnect";

const tabs = [
  { href: "/", label: "Markets", icon: Layers3 },
  { href: "/portfolio", label: "Portfolio", icon: WalletCards },
  { href: "/create", label: "Create", icon: CirclePlus },
  { href: "/agents", label: "Agents", icon: Bot }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_8%_0%,rgba(155,92,255,0.2),transparent_30rem),radial-gradient(circle_at_82%_10%,rgba(25,245,140,0.12),transparent_32rem)]" />
      <header className="sticky top-0 z-50 border-b border-line bg-black/70 backdrop-blur-xl">
        <div className="mx-auto grid h-16 max-w-[1720px] grid-cols-[260px_1fr_auto] items-center px-5">
          <Link href="/" className="flex w-max items-center gap-3">
            <span className="probx-logo-mark" aria-hidden="true">
              <span className="probx-logo-slice slice-a" />
              <span className="probx-logo-slice slice-b" />
              <span className="probx-logo-slice slice-c" />
              <span className="probx-logo-slice slice-d" />
            </span>
            <span className="text-3xl font-black tracking-tight">ProbX</span>
          </Link>

          <nav className="flex justify-center gap-3">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className="group flex h-10 items-center gap-2 rounded-lg border border-transparent px-4 text-sm text-slate-300 transition hover:border-solPurple/60 hover:bg-solPurple/15 hover:text-white hover:shadow-glow"
                >
                  <Icon size={16} className="text-violet-300" />
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
      <main className="mx-auto max-w-[1720px] px-4 py-4">{children}</main>
      <footer className="fixed bottom-3 left-4 right-4 z-40 hidden overflow-hidden rounded-lg border border-solBlue/25 bg-slate-950/90 shadow-[0_0_28px_rgba(49,185,255,0.10)] backdrop-blur-xl xl:block">
        <Ticker />
      </footer>
    </div>
  );
}

function Ticker() {
  const items = [
    { market: "Fed cut rates", side: "YES", probability: "62%", change: "-2.1%" },
    { market: "BTC > $100k", side: "NO", probability: "58%", change: "+3.1%" },
    { market: "Solana ETF", side: "YES", probability: "62%", change: "+4.1%" },
    { market: "NBA Finals", side: "NO", probability: "58%", change: "-5.1%" },
    { market: "On-chain validators", side: "YES", probability: "62%", change: "+6.1%" },
    { market: "SOL daily users", side: "YES", probability: "67%", change: "+2.8%" },
    { market: "ETH > $5k", side: "NO", probability: "54%", change: "-1.6%" }
  ];

  return (
    <div className="ticker-shell">
      <div className="ticker-track">
        {[0, 1].map((group) => (
          <div key={group} className="ticker-group" aria-hidden={group === 1}>
            {items.map((item) => (
              <div key={`${group}-${item.market}`} className="ticker-item">
                <span className="h-2 w-2 rounded-full bg-yes shadow-[0_0_12px_#19f58c]" />
                <span className="text-slate-300">{item.market}</span>
                <b className={item.side === "YES" ? "text-yes" : "text-no"}>
                  {item.side} {item.probability}
                </b>
                <span className={item.change.startsWith("+") ? "text-yes" : "text-no"}>
                  {item.change.startsWith("+") ? "▲" : "▼"} {item.change.replace("+", "").replace("-", "")}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
