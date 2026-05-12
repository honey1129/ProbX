"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatPrice } from "@/lib/format";
import type { Market, Side } from "@/lib/types";
import { ProbabilityChart, type ChartTimeframe } from "./ProbabilityChart";

export type { ChartTimeframe };

type ChartSide = Side | "BOTH";
type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};
type LinePoint = { time: number; value: number };
type SeriesApi = {
  setData: (data: Array<Candle | LinePoint>) => void;
};
type ChartApi = {
  addSeries: (seriesType: unknown, options?: Record<string, unknown>) => SeriesApi;
  applyOptions: (options: Record<string, unknown>) => void;
  resize: (width: number, height: number) => void;
  remove: () => void;
  timeScale: () => {
    fitContent: () => void;
  };
};
type LightweightChartsGlobal = {
  createChart: (container: HTMLElement, options?: Record<string, unknown>) => ChartApi;
  CandlestickSeries: unknown;
  LineSeries: unknown;
};

declare global {
  interface Window {
    LightweightCharts?: LightweightChartsGlobal;
    __probxLightweightCharts?: Promise<LightweightChartsGlobal>;
  }
}

const LIGHTWEIGHT_CHARTS_SRC = "https://unpkg.com/lightweight-charts@5.0.3/dist/lightweight-charts.standalone.production.js";

export function TradingViewKlineChart({
  market,
  compact = false,
  side = "BOTH",
  timeframe = "1D"
}: {
  market: Market;
  compact?: boolean;
  side?: ChartSide;
  timeframe?: ChartTimeframe;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const candles = useMemo(() => buildCandles(market.probabilityHistory, side, timeframe), [market.probabilityHistory, side, timeframe]);
  const secondaryLine = useMemo(() => (side === "BOTH" ? candles.map((item) => ({ time: item.time, value: toPrice(1 - item.close / 100) })) : []), [candles, side]);
  const latest = candles[candles.length - 1];
  const latestYes = side === "NO" ? (latest ? 100 - latest.close : 0) : latest?.close ?? 0;
  const latestNo = side === "NO" ? latest?.close ?? 0 : latest ? 100 - latest.close : 0;
  const primaryLabel = side === "NO" ? "NO" : "YES";
  const primaryValue = side === "NO" ? latestNo : latestYes;
  const primaryClass =
    side === "NO"
      ? "border-no/35 bg-no/10 text-no"
      : "border-yes/35 bg-yes/10 text-yes";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let chart: ChartApi | null = null;
    let resizeObserver: ResizeObserver | null = null;

    setLoadError(false);
    loadLightweightCharts()
      .then((lightweightCharts) => {
        if (disposed) return;
        const minChartWidth = compact ? 300 : 280;
        const width = Math.max(minChartWidth, container.clientWidth);
        const height = Math.max(240, container.clientHeight);

        chart = lightweightCharts.createChart(container, {
          width,
          height,
          layout: {
            background: { type: "solid", color: "transparent" },
            textColor: "#8ba5b9",
            fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
          },
          grid: {
            vertLines: { color: "rgba(125,170,255,0.08)" },
            horzLines: { color: "rgba(125,170,255,0.11)" }
          },
          crosshair: {
            vertLine: { color: "rgba(235,245,255,0.42)", labelBackgroundColor: "#111827" },
            horzLine: { color: "rgba(235,245,255,0.34)", labelBackgroundColor: "#111827" }
          },
          rightPriceScale: {
            borderColor: "rgba(125,170,255,0.18)",
            scaleMargins: { top: 0.08, bottom: 0.12 }
          },
          timeScale: {
            borderColor: "rgba(125,170,255,0.18)",
            timeVisible: true,
            secondsVisible: false,
            rightOffset: compact ? 2 : 4,
            barSpacing: compact ? 7 : 9
          },
          localization: {
            priceFormatter: (price: number) => `${price.toFixed(price >= 10 ? 1 : 2)}¢`
          }
        });

        const candleSeries = chart.addSeries(lightweightCharts.CandlestickSeries, {
          upColor: "#19f58c",
          downColor: "#ff4e5c",
          borderVisible: false,
          wickUpColor: "#19f58c",
          wickDownColor: "#ff4e5c",
          priceFormat: { type: "price", precision: 2, minMove: 0.01 }
        });
        candleSeries.setData(candles);

        if (side === "BOTH" && secondaryLine.length) {
          const lineSeries = chart.addSeries(lightweightCharts.LineSeries, {
            color: "#b169ff",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            priceFormat: { type: "price", precision: 2, minMove: 0.01 }
          });
          lineSeries.setData(secondaryLine);
        }

        chart.timeScale().fitContent();
        resizeObserver = new ResizeObserver(([entry]) => {
          if (!chart || !entry) return;
          chart.resize(Math.max(minChartWidth, Math.floor(entry.contentRect.width)), Math.max(240, Math.floor(entry.contentRect.height)));
        });
        resizeObserver.observe(container);
      })
      .catch(() => {
        if (!disposed) setLoadError(true);
      });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      chart?.remove();
      container.replaceChildren();
    };
  }, [candles, compact, secondaryLine, side]);

  if (loadError) {
    return <ProbabilityChart market={market} compact={compact} side={side} timeframe={timeframe} />;
  }

  return (
    <div className={compact ? "chart-card h-full min-h-[250px]" : "chart-card h-[360px] sm:h-[420px]"}>
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-3 top-3 flex gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 font-black ${primaryClass}`}>
          <i className={`h-2 w-2 rounded-full ${side === "NO" ? "bg-no" : "bg-yes"}`} /> {primaryLabel} {formatPrice(primaryValue / 100)}
        </span>
        {side === "BOTH" ? (
          <span className="inline-flex items-center gap-1 rounded border border-solPurple/45 bg-solPurple/15 px-2 py-1 font-black text-violet-200">
            <i className="h-2 w-2 rounded-full bg-solPurple" /> NO {formatPrice(latestNo / 100)}
          </span>
        ) : null}
      </div>
      <a
        href="https://www.tradingview.com"
        target="_blank"
        rel="noreferrer"
        className="absolute bottom-3 left-4 z-10 text-[10px] font-bold text-slate-500 transition hover:text-slate-300"
      >
        Lightweight Charts™ by TradingView
      </a>
    </div>
  );
}

function loadLightweightCharts() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("TradingView Lightweight Charts requires a browser."));
  }
  if (window.LightweightCharts) return Promise.resolve(window.LightweightCharts);
  if (window.__probxLightweightCharts) return window.__probxLightweightCharts;

  window.__probxLightweightCharts = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = LIGHTWEIGHT_CHARTS_SRC;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (window.LightweightCharts) resolve(window.LightweightCharts);
      else reject(new Error("TradingView Lightweight Charts did not expose a global API."));
    };
    script.onerror = () => reject(new Error("Unable to load TradingView Lightweight Charts."));
    document.head.appendChild(script);
  });

  return window.__probxLightweightCharts;
}

function buildCandles(values: number[], side: ChartSide, timeframe: ChartTimeframe) {
  const history = sliceHistory(values.length ? values : [0.5], timeframe).map((value) => (side === "NO" ? 1 - value : value));
  const chunkSize = Math.max(1, Math.ceil(history.length / maxCandles(timeframe)));
  const chunks: number[][] = [];

  for (let index = 0; index < history.length; index += chunkSize) {
    chunks.push(history.slice(index, index + chunkSize));
  }

  const spanSeconds = secondsForTimeframe(timeframe);
  const now = Math.floor(Date.now() / 1000);
  const stepSeconds = Math.max(60, Math.floor(spanSeconds / Math.max(1, chunks.length - 1 || 1)));

  return chunks.map((chunk, index) => {
    const prices = chunk.map(toPrice);
    return {
      time: now - (chunks.length - index - 1) * stepSeconds,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1]
    };
  });
}

function toPrice(value: number) {
  return Number((clamp(value) * 100).toFixed(2));
}

function clamp(value: number) {
  return Math.max(0.01, Math.min(0.99, value));
}

function sliceHistory(values: number[], timeframe: ChartTimeframe) {
  if (timeframe === "ALL") return values;

  const sizeByTimeframe: Record<Exclude<ChartTimeframe, "ALL">, number> = {
    "1H": 24,
    "4H": 48,
    "1D": 72,
    "1W": 96,
    "1M": 120
  };
  return values.slice(-sizeByTimeframe[timeframe]);
}

function maxCandles(timeframe: ChartTimeframe) {
  if (timeframe === "1H") return 36;
  if (timeframe === "4H") return 48;
  if (timeframe === "1D") return 56;
  return 72;
}

function secondsForTimeframe(timeframe: ChartTimeframe) {
  if (timeframe === "1H") return 60 * 60;
  if (timeframe === "4H") return 4 * 60 * 60;
  if (timeframe === "1D") return 24 * 60 * 60;
  if (timeframe === "1W") return 7 * 24 * 60 * 60;
  if (timeframe === "1M") return 30 * 24 * 60 * 60;
  return 90 * 24 * 60 * 60;
}
