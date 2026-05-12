"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { Check, ChevronDown, Copy, ExternalLink, LogOut, RefreshCw, Wallet } from "lucide-react";
import { useWalletError } from "@/components/Providers";
import { getRuntimeConfig } from "@/lib/runtimeConfig";

export function WalletConnect() {
  const { connected, connecting, connect, disconnect, disconnecting, publicKey, select, wallet, wallets } = useWallet();
  const { error, clearError } = useWalletError();
  const runtimeConfig = getRuntimeConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [pendingWalletName, setPendingWalletName] = useState<WalletName | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const walletPickerRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const address = publicKey?.toBase58() ?? "";
  const label = connected && address ? shortAddress(address) : connecting ? "Connecting" : "Connect Wallet";
  const walletIcon = wallet?.adapter.icon;
  const walletName = wallet?.adapter.name ?? "Wallet";

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      const target = event.target as Node;
      if (!wrapperRef.current?.contains(target) && !walletPickerRef.current?.contains(target) && !accountMenuRef.current?.contains(target)) {
        setMenuOpen(false);
        setWalletPickerOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setWalletPickerOpen(false);
      }
    }

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (!wallet || wallet.adapter.name !== pendingWalletName || connected || connecting) return;
    const ready = wallet.readyState === WalletReadyState.Installed || wallet.readyState === WalletReadyState.Loadable;
    if (!ready) return;

    let cancelled = false;
    connect()
      .catch(() => {
        // WalletProvider onError renders the actionable message.
      })
      .finally(() => {
        if (!cancelled) setPendingWalletName(null);
      });

    return () => {
      cancelled = true;
    };
  }, [connect, connected, connecting, pendingWalletName, wallet]);

  useEffect(() => {
    if (!connected) return;
    setWalletPickerOpen(false);
    setPendingWalletName(null);
  }, [connected]);

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  async function disconnectWallet() {
    setMenuOpen(false);
    setWalletPickerOpen(false);
    await disconnect();
  }

  function openWalletPicker() {
    clearError();
    setMenuOpen(false);
    setWalletPickerOpen((value) => !value);
  }

  function selectWallet(walletName: WalletName) {
    clearError();
    setPendingWalletName(walletName);
    select(walletName);
  }

  function handleMainClick() {
    if (!connected) {
      openWalletPicker();
      return;
    }
    setMenuOpen((value) => !value);
  }

  const walletPicker =
    walletPickerOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed inset-0 z-[10080] grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
            <div ref={walletPickerRef} className="w-full max-w-sm overflow-hidden rounded-lg border border-solPurple/35 bg-slate-950/95 shadow-[0_24px_70px_rgba(0,0,0,0.62),0_0_28px_rgba(155,92,255,0.18)]">
              <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4">
                <div>
                  <div className="text-sm font-black text-white">Connect wallet</div>
                  <div className="mt-1 text-xs text-muted">Choose a Solana wallet to open its extension.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletPickerOpen(false)}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-black/25 text-slate-300 transition hover:border-solBlue/40 hover:text-white"
                  aria-label="Close wallet picker"
                >
                  x
                </button>
              </div>
              <div className="grid p-2">
                {wallets.map((item) => {
                  const isReady = item.readyState === WalletReadyState.Installed || item.readyState === WalletReadyState.Loadable;
                  return (
                    <button
                      key={item.adapter.name}
                      type="button"
                      onClick={() => {
                        if (isReady) selectWallet(item.adapter.name);
                        else window.open(item.adapter.url, "_blank", "noopener,noreferrer");
                      }}
                      className="flex items-center justify-between gap-3 rounded-md px-3 py-3 text-left text-sm font-bold text-slate-200 transition hover:bg-solPurple/10 hover:text-white"
                    >
                      <span className="inline-flex min-w-0 items-center gap-3">
                        <img src={item.adapter.icon} alt="" className="h-7 w-7 rounded" />
                        <span className="truncate">{item.adapter.name}</span>
                      </span>
                      {isReady ? (
                        <span className="rounded border border-yes/25 bg-yes/10 px-2 py-0.5 text-[11px] text-yes">
                          {item.readyState === WalletReadyState.Installed ? "Detected" : "Connect"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded border border-line bg-black/25 px-2 py-0.5 text-[11px] text-muted">
                          Install <ExternalLink size={11} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const accountMenu =
    connected && menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div className="fixed right-5 top-[70px] z-[10080] w-72 overflow-hidden rounded-lg border border-solBlue/30 bg-slate-950/95 shadow-[0_18px_48px_rgba(0,0,0,0.55),0_0_24px_rgba(49,185,255,0.14)] backdrop-blur-xl" ref={accountMenuRef}>
            <div className="border-b border-line px-3 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg border border-solPurple/40 bg-solPurple/20">
                  {walletIcon ? <img src={walletIcon} alt="" className="h-6 w-6 rounded" /> : <Wallet size={18} className="text-violet-100" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-white">{walletName}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted">{shortAddress(address, 6, 6)}</p>
                </div>
              </div>
            </div>

            <div className="grid p-1.5">
              <button
                type="button"
                onClick={copyAddress}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-solBlue/10 hover:text-white"
              >
                <span className="inline-flex items-center gap-2">
                  {copied ? <Check size={16} className="text-yes" /> : <Copy size={16} className="text-solBlue" />}
                  {copied ? "Address copied" : "Copy address"}
                </span>
                <span className="font-mono text-xs text-muted">{shortAddress(address)}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setWalletPickerOpen(true);
                }}
                className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-solPurple/10 hover:text-white"
              >
                <RefreshCw size={16} className="text-violet-200" />
                Change wallet
              </button>

              {runtimeConfig.faucetUrl ? (
                <a
                  href={runtimeConfig.faucetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-solBlue/10 hover:text-white"
                >
                  <span className="inline-flex items-center gap-2">
                    <ExternalLink size={16} className="text-solBlue" />
                    Get test SOL
                  </span>
                  <span className="rounded border border-solBlue/30 bg-solBlue/10 px-2 py-0.5 text-[11px] uppercase text-solBlue">
                    {runtimeConfig.label}
                  </span>
                </a>
              ) : null}

              <button
                type="button"
                onClick={disconnectWallet}
                disabled={disconnecting}
                className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-bold text-no transition hover:bg-no/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut size={16} />
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={wrapperRef} className="relative z-[10050]">
      <button
        type="button"
        onClick={handleMainClick}
        className="probx-wallet-button inline-flex items-center justify-center gap-2 px-3 text-white sm:px-4"
        aria-expanded={menuOpen}
      >
        {walletIcon ? (
          <img src={walletIcon} alt="" className="h-5 w-5 rounded" />
        ) : (
          <Wallet size={17} className="text-violet-100" />
        )}
        <span className="hidden sm:inline">{label}</span>
        {connected ? <ChevronDown size={15} className={menuOpen ? "rotate-180 text-violet-100 transition" : "text-violet-100 transition"} /> : null}
      </button>

      {walletPicker}

      {accountMenu}
      {!connected && error ? (
        <div className="absolute right-0 top-[calc(100%+10px)] z-[10060] w-72 rounded-lg border border-no/35 bg-slate-950/95 p-3 text-xs text-no shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl">
          <div className="font-bold">Wallet connection failed</div>
          <div className="mt-1 leading-5 text-red-200">{error}</div>
          <button type="button" onClick={clearError} className="mt-2 font-black text-slate-200 transition hover:text-white">
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}

function shortAddress(address: string, head = 4, tail = 4) {
  if (address.length <= head + tail + 3) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}
