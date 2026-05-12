"use client";

import { Bot, CirclePlus, Github, Layers3, MessageCircle, Send, WalletCards } from "lucide-react";
import { useMemo } from "react";
import type { ElementType } from "react";
import { WalletConnect } from "@/components/WalletConnect";
import { useMarkets } from "@/components/market/MarketProvider";
import { formatPercent, probability } from "@/lib/format";
import { getRuntimeConfig } from "@/lib/runtimeConfig";
import { RouterLink as Link, usePathname } from "@/router";

const tabs = [
  { href: "/", label: "Markets", icon: Layers3 },
  { href: "/portfolio", label: "Portfolio", icon: WalletCards },
  { href: "/create", label: "Create", icon: CirclePlus },
  { href: "/agents", label: "Agents", icon: Bot }
];

type SocialIcon = ElementType<{ size?: string | number; className?: string }>;
type SocialLinkConfig = { label: string; href?: string; icon: SocialIcon };
type SocialLink = { label: string; href?: string; icon: SocialIcon };

function publicUrl(value: string | undefined) {
  const url = value?.trim();
  return url || undefined;
}

const socialLinkConfigs: SocialLinkConfig[] = [
  { label: "X", href: publicUrl(process.env.NEXT_PUBLIC_X_URL), icon: XIcon },
  { label: "Discord", href: publicUrl(process.env.NEXT_PUBLIC_DISCORD_URL), icon: MessageCircle },
  { label: "Telegram", href: publicUrl(process.env.NEXT_PUBLIC_TELEGRAM_URL), icon: Send },
  { label: "GitHub", href: publicUrl(process.env.NEXT_PUBLIC_GITHUB_URL), icon: Github }
];

const socialLinks: SocialLink[] = socialLinkConfigs;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const runtimeConfig = useMemo(() => getRuntimeConfig(), []);
  const hasTestnetBanner = runtimeConfig.isTestnetMode;

  return (
    <div className="h-dvh overflow-hidden bg-canvas text-slate-100">
      {hasTestnetBanner ? (
        <div className="flex h-8 w-full items-center justify-center bg-[#e11d2e] px-3 text-center text-xs font-black uppercase tracking-wide text-white shadow-[0_8px_24px_rgba(225,29,46,0.22)] sm:text-sm">
          <span className="truncate">Testnet Mode - Solana Testnet - Test Funds Only</span>
        </div>
      ) : null}
      <header className="h-[60px] border-b border-line bg-black/80 backdrop-blur-xl">
        <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:px-4 md:grid-cols-[minmax(160px,auto)_1fr_auto] md:gap-3 2xl:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2 md:w-max md:gap-3">
            <span className="probx-logo-mark" aria-hidden="true">
              <span className="probx-logo-slice slice-a" />
              <span className="probx-logo-slice slice-b" />
              <span className="probx-logo-slice slice-c" />
              <span className="probx-logo-slice slice-d" />
            </span>
            <span className="text-2xl font-black tracking-tight md:text-[27px]">ProbX</span>
            {runtimeConfig.isTestnetMode ? (
              <span className="hidden rounded border border-solBlue/40 bg-solBlue/10 px-2 py-1 text-[11px] font-black uppercase text-solBlue sm:inline-flex">
                Testnet
              </span>
            ) : null}
          </Link>

          <nav className="hidden justify-center gap-2 md:flex xl:gap-5 2xl:gap-7">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = tab.href === "/" ? pathname === "/" || pathname.startsWith("/markets") : pathname.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`group flex h-9 items-center gap-2 rounded-lg border px-3 text-sm transition xl:px-3.5 ${
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

          <div className="flex min-w-0 items-center justify-end gap-2 xl:gap-3">
            <SocialLinks placement="header" />
            <WalletConnect />
          </div>
        </div>
      </header>
      <main className={`${hasTestnetBanner ? "h-[calc(100dvh-164px)] md:h-[calc(100dvh-136px)]" : "h-[calc(100dvh-132px)] md:h-[calc(100dvh-104px)]"} w-full overflow-x-hidden overflow-y-scroll px-2.5 py-2.5 pb-[calc(76px+env(safe-area-inset-bottom))] md:pb-2.5 2xl:px-4`}>
        {children}
      </main>
      <footer className="fixed bottom-2.5 left-2.5 right-2.5 z-40 hidden overflow-hidden rounded-lg border border-solBlue/25 bg-slate-950/90 shadow-[0_0_28px_rgba(49,185,255,0.10)] backdrop-blur-xl xl:block">
        <Ticker />
      </footer>
      <MobileNav pathname={pathname} />
    </div>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-solBlue/20 bg-slate-950/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-14px_34px_rgba(0,0,0,0.38)] backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-4 gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.href === "/" ? pathname === "/" || pathname.startsWith("/markets") : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`grid min-h-[52px] place-items-center gap-1 rounded-lg border px-1 py-1 text-[11px] font-black transition ${
                active
                  ? "border-solPurple/60 bg-solPurple/20 text-white shadow-glow"
                  : "border-transparent text-slate-400 active:bg-white/5"
              }`}
            >
              <Icon size={18} className={active ? "text-white" : "text-violet-300"} />
              <span className="leading-none">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Ticker() {
  const { markets, backendEnabled } = useMarkets();
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
        {items.length ? (
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
        ) : (
          <div className="flex h-full items-center px-4 text-muted">
            {backendEnabled ? "No markets indexed yet" : "No local markets available"}
          </div>
        )}
      </div>
      <Link href="/markets" className="flex h-full shrink-0 items-center px-5 text-slate-300 transition hover:text-white">
        View All
      </Link>
      <div className="flex h-full shrink-0 items-center border-l border-line px-3">
        <SocialLinks placement="footer" />
      </div>
    </div>
  );
}

function SocialLinks({ placement }: { placement: "header" | "footer" }) {
  if (!socialLinks.length) return null;

  return (
    <div className={placement === "header" ? "hidden items-center gap-1.5 xl:flex" : "flex items-center gap-1.5"}>
      {socialLinks.map((item) => {
        const Icon = item.icon;
        const className =
          "grid h-9 w-9 place-items-center rounded-lg border border-line bg-slate-950/70 text-slate-300 transition hover:border-solBlue/45 hover:bg-solBlue/10 hover:text-white";

        return item.href ? (
          <a
            key={item.label}
            href={item.href}
            target="_blank"
            rel="noreferrer"
            aria-label={item.label}
            title={item.label}
            className={className}
          >
            <Icon size={16} />
          </a>
        ) : (
          <span key={item.label} aria-label={item.label} title={item.label} className={className}>
            <Icon size={16} />
          </span>
        );
      })}
    </div>
  );
}

function XIcon({ size = 16, className }: { size?: string | number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17.53 3h3.12l-6.82 7.8L21.85 21h-6.28l-4.92-6.43L5.02 21H1.9l7.29-8.34L1.5 3h6.44l4.45 5.88L17.53 3Zm-1.1 16.2h1.73L7 4.71H5.14L16.43 19.2Z"
      />
    </svg>
  );
}
