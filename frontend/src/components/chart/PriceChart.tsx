import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Bars } from "../../api/types";
import { compact, isNum, pct, price, tidy } from "../../lib/format";
import { useTheme, tokens } from "../../theme/theme";
import { barTime } from "../../state/view";
import { WindowShade } from "./windowShade";

interface Props {
  bars: Bars;
  a: number;
  b: number;
  loading?: boolean;
}

interface Legend {
  i: number; // index into bars arrays
  live: boolean; // under the crosshair (vs. pinned to the window end)
}

const fmtTime = (t: number) => {
  const d = new Date(t * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** TradingView Lightweight Charts: candles + VWAP, volume pane, and an OI pane for futures.
 *  The selected window is shaded in every pane; the legend shows the bar under the crosshair,
 *  or the window's last bar when the pointer is elsewhere. */
export function PriceChart({ bars, a, b, loading }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<{ candles: ISeriesApi<"Candlestick">; vwap: ISeriesApi<"Line">; volume: ISeriesApi<"Histogram">; oi?: ISeriesApi<"Line"> } | null>(null);
  const shades = useRef<WindowShade[]>([]);
  const theme = useTheme((s) => s.theme);
  const isFut = bars.src === "fut" && !!bars.oi;
  const [legend, setLegend] = useState<Legend | null>(null);

  const index = useMemo(() => new Map(bars.t.map((t, i) => [t, i])), [bars]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const session = bars.sessions[bars.sessions.length - 1];
  const dayStart = bars.t[session.start] - (((bars.t[session.start] / 60) % 1440) - 555) * 60; // 09:15 of the selected day

  // window → first/last existing bar times of the selected session
  const range = useMemo(() => {
    const from = dayStart + a * 300;
    const to = dayStart + b * 300;
    const inDay = bars.t.slice(session.start, session.start + session.bars);
    const first = inDay.find((t) => t >= from);
    const last = [...inDay].reverse().find((t) => t <= to);
    return first !== undefined && last !== undefined && first <= last ? { from: first, to: last } : null;
  }, [bars, a, b, dayStart, session]);
  const pinned = range ? index.get(range.to) ?? null : null;

  // create the chart once per source / theme (series layout differs for futures)
  useEffect(() => {
    if (!el.current) return;
    const t = tokens();
    const c = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: t.surface },
        textColor: t.ink3,
        fontFamily: t.fontMono,
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: t.grid, separatorHoverColor: t.surface2, enableResize: true },
      },
      grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
      rightPriceScale: { borderColor: t.axis, scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderColor: t.axis, timeVisible: true, secondsVisible: false, rightOffset: 3, barSpacing: 9, minBarSpacing: 2 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: t.ink3, width: 1, style: 0, labelBackgroundColor: t.ink2 },
        horzLine: { color: t.ink3, width: 1, style: 0, labelBackgroundColor: t.ink2 },
      },
    });
    const candles = c.addSeries(CandlestickSeries, {
      upColor: t.up,
      downColor: t.down,
      borderUpColor: t.up,
      borderDownColor: t.down,
      wickUpColor: t.up,
      wickDownColor: t.down,
      priceLineVisible: false,
      priceFormat: { type: "custom", formatter: (p: number) => price(p), minMove: 0.05 },
    });
    const vwap = c.addSeries(LineSeries, {
      color: t.vwap,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: "custom", formatter: (p: number) => price(p), minMove: 0.05 },
    });
    const volume = c.addSeries(
      HistogramSeries,
      { priceFormat: { type: "custom", formatter: (v: number) => tidy(compact(v)), minMove: 1 }, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    const oi = isFut
      ? c.addSeries(
          LineSeries,
          { color: t.accent, lineWidth: 2, priceLineVisible: false, priceFormat: { type: "custom", formatter: (v: number) => tidy(compact(v)), minMove: 1 } },
          2,
        )
      : undefined;
    const panes = c.panes();
    panes[0]?.setStretchFactor(isFut ? 3.2 : 3.6);
    panes[1]?.setStretchFactor(1);
    panes[2]?.setStretchFactor(1.1);
    shades.current = panes.map((p) => {
      const s = new WindowShade();
      p.attachPrimitive(s);
      return s;
    });
    series.current = { candles, vwap, volume, oi };
    chart.current = c;

    const onMove = (p: MouseEventParams<Time>) => {
      const i = p.time !== undefined ? indexRef.current.get(p.time as number) : undefined;
      setLegend(i === undefined ? null : { i, live: true });
    };
    c.subscribeCrosshairMove(onMove);
    return () => {
      c.unsubscribeCrosshairMove(onMove);
      c.remove();
      chart.current = null;
      series.current = null;
      shades.current = [];
    };
  }, [isFut, theme]);

  // data
  useEffect(() => {
    const s = series.current;
    const c = chart.current;
    if (!s || !c) return;
    const t = tokens();
    const candles = [];
    const vwap = [];
    const vol = [];
    const oi = [];
    for (let i = 0; i < bars.t.length; i++) {
      const time = bars.t[i] as UTCTimestamp;
      const [o, h, l, cl] = [bars.o[i], bars.h[i], bars.l[i], bars.c[i]];
      if (isNum(o) && isNum(h) && isNum(l) && isNum(cl)) candles.push({ time, open: o, high: h, low: l, close: cl });
      if (isNum(bars.vwap[i])) vwap.push({ time, value: bars.vwap[i] as number });
      if (isNum(bars.v[i])) vol.push({ time, value: bars.v[i] as number, color: isNum(cl) && isNum(o) && cl < o ? t.downWash : t.upWash });
      if (bars.oi && isNum(bars.oi[i])) oi.push({ time, value: bars.oi[i] as number });
    }
    s.candles.setData(candles);
    s.vwap.setData(vwap);
    s.volume.setData(vol);
    s.oi?.setData(oi);
    // frame the selected session
    const first = session.start;
    const last = session.start + session.bars - 1;
    c.timeScale().setVisibleLogicalRange({ from: first - 1, to: last + 3 });
  }, [bars, session, isFut, theme]);

  // window shading
  useEffect(() => {
    const t = tokens();
    shades.current.forEach((s) => s.set(range, t.accentWash, t.accent));
  }, [range, theme, isFut, bars]);

  const li = legend?.i ?? pinned;
  const prevClose = li !== null && li > 0 ? bars.c[li - 1] : null;
  const close = li !== null ? bars.c[li] : null;
  const chg = isNum(close) && isNum(prevClose) ? ((close - prevClose) / prevClose) * 100 : null;

  return (
    <div className={`price-chart${loading ? " is-loading" : ""}`}>
      <div className="chart-legend" aria-live="off">
        {li !== null ? (
          <>
            <span className="lg-time">{legend?.live ? fmtTime(bars.t[li]) : `${fmtTime(bars.t[li])} · window end`}</span>
            <span>
              O <b>{price(bars.o[li])}</b>
            </span>
            <span>
              H <b>{price(bars.h[li])}</b>
            </span>
            <span>
              L <b>{price(bars.l[li])}</b>
            </span>
            <span>
              C <b>{price(close)}</b>
            </span>
            {isNum(chg) && <span className={chg >= 0 ? "up" : "down"}>{pct(chg)}</span>}
            <span>
              <i className="key-line" style={{ background: "var(--vwap)" }} /> VWAP <b>{price(bars.vwap[li])}</b>
            </span>
            <span>
              Vol <b>{compact(bars.v[li])}</b>
            </span>
            {isFut && (
              <span>
                <i className="key-line" style={{ background: "var(--accent)" }} /> OI <b>{compact(bars.oi?.[li])}</b>
              </span>
            )}
          </>
        ) : (
          <span className="muted">Window {barTime(a)} has no bars</span>
        )}
      </div>
      <div className="chart-canvas" ref={el} />
    </div>
  );
}
