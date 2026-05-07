"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Check, ChevronDown, Copy, LogOut, RefreshCw, Wallet } from "lucide-react";
import { useWalletError } from "@/components/Providers";

export function WalletConnect() {
  const { connected, connecting, disconnect, disconnecting, publicKey, wallet } = useWallet();
  const { setVisible } = useWalletModal();
  const { error, clearError } = useWalletError();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const address = publicKey?.toBase58() ?? "";
  const label = connected && address ? shortAddress(address) : connecting ? "Connecting" : "Connect Wallet";
  const walletIcon = wallet?.adapter.icon;
  const walletName = wallet?.adapter.name ?? "Wallet";

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

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
    await disconnect();
  }

  function handleMainClick() {
    if (!connected) {
      clearError();
      setVisible(true);
      return;
    }
    setMenuOpen((value) => !value);
  }

  return (
    <div ref={wrapperRef} className="relative z-[10050]">
      <button
        type="button"
        onClick={handleMainClick}
        className="probx-wallet-button inline-flex items-center justify-center gap-2 px-4 text-white"
        aria-expanded={menuOpen}
      >
        {walletIcon ? (
          <img src={walletIcon} alt="" className="h-5 w-5 rounded" />
        ) : (
          <Wallet size={17} className="text-violet-100" />
        )}
        <span>{label}</span>
        {connected ? <ChevronDown size={15} className={menuOpen ? "rotate-180 text-violet-100 transition" : "text-violet-100 transition"} /> : null}
      </button>

      {connected && menuOpen ? (
        <div className="absolute right-0 top-[calc(100%+10px)] z-[10060] w-72 overflow-hidden rounded-lg border border-solBlue/30 bg-slate-950/95 shadow-[0_18px_48px_rgba(0,0,0,0.55),0_0_24px_rgba(49,185,255,0.14)] backdrop-blur-xl">
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
                setVisible(true);
              }}
              className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-solPurple/10 hover:text-white"
            >
              <RefreshCw size={16} className="text-violet-200" />
              Change wallet
            </button>

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
        </div>
      ) : null}
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
