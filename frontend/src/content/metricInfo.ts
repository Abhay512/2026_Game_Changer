/** What every metric tells you, shown in its info tip. Keep each part to one or two sentences. */
export interface MetricInfo {
  title: string;
  what: string; // what it tells you
  read: string; // how to read it
}

export const METRIC_INFO: Record<string, MetricInfo> = {
  // ---- price ---------------------------------------------------------------------------
  "price.last": {
    title: "Last price",
    what: "Price at the end of the selected window, and how much it moved since the window started. At 09:15 the start is yesterday's close, so a full-day window shows the usual day change.",
    read: "The strip below compares the size of this move with the same time slot on the last 20 sessions. Far right on the strip means today's move is one of the biggest.",
  },
  "price.vwap": {
    title: "VWAP",
    what: "Volume-weighted average price since 09:15: the average price everyone actually paid today. Institutions use it as the day's fair value.",
    read: "Price above VWAP means buyers are paying up and control the session; below VWAP means sellers do. The share of bars that closed above VWAP shows how steady that control was.",
  },
  "price.speed": {
    title: "Price speed",
    what: "How big the price move in this window is compared with a normal day at the same time. 2.0× means twice the usual move.",
    read: "Above 1.5× is an unusually fast move (news, a large order, a breakout). Below 0.7× is a quiet market. Speed ignores direction; check Last price for that.",
  },
  // ---- turnover ------------------------------------------------------------------------
  "turnover.window": {
    title: "Turnover in window",
    what: "Rupee value traded inside the selected window (price × quantity).",
    read: "The × compares it with the same window on the last 20 sessions. Above 1.5× means money is flowing in unusually; large turnover with a strong price move shows conviction.",
  },
  "turnover.day": {
    title: "Turnover since open",
    what: "Rupee value traded from 09:15 up to the end of the window, i.e. today's running total at that moment.",
    read: "Compared with what had traded by the same time on normal days. Useful when the window is short: tells you whether the whole day so far is busy, not only this slot.",
  },
  "turnover.last5": {
    title: "Turnover, last 5 min",
    what: "Rupee value traded in the last 5-minute bar of the window.",
    read: "A spike here (3× or more) often marks the exact moment a big participant stepped in. Compare with the price card to see which way they pushed.",
  },
  // ---- volume --------------------------------------------------------------------------
  "volume.window": {
    title: "Volume in window",
    what: "Number of shares (or futures quantity) traded inside the selected window.",
    read: "The × compares it with the same window on the last 20 sessions. Rising price on high volume is a stronger signal than the same move on thin volume.",
  },
  "volume.day": {
    title: "Volume since open",
    what: "Quantity traded from 09:15 to the end of the window.",
    read: "Above 1× means today is running busier than normal at this time of day. Volume usually clusters at the open and close, which the time-matched comparison already accounts for.",
  },
  "volume.last5": {
    title: "Volume, last 5 min",
    what: "Quantity traded in the last 5-minute bar of the window.",
    read: "Read it with the 20-day average for the same bar: a sudden jump is the freshest sign of new interest.",
  },
  // ---- buy / sell ----------------------------------------------------------------------
  "flow.buy": {
    title: "Buy volume",
    what: "Estimated quantity bought aggressively in the window. The data has no buyer/seller split, so each bar's volume is divided by how strongly price moved in it (Bulk Volume Classification).",
    read: "The × compares it with buying in the same window on the last 20 sessions. High buy × with a rising price means real demand.",
  },
  "flow.sell": {
    title: "Sell volume",
    what: "Estimated quantity sold aggressively in the window, using the same Bulk Volume Classification split.",
    read: "High sell × while price holds up can mean sellers are being absorbed; high sell × with falling price is genuine selling pressure.",
  },
  "flow.ratio": {
    title: "Buy / sell ratio",
    what: "Estimated buy volume divided by estimated sell volume in the window. 1.00 is balanced.",
    read: "Above 1.2 buyers dominate, below 0.8 sellers do. The × shows whether today's balance is more one-sided than this time slot usually is.",
  },
  "flow.last5": {
    title: "Buy / sell, last 5 min",
    what: "The buy and sell split of the last 5-minute bar in the window.",
    read: "Shows who is in control right now, at the end of the window. One bar is noisy, so trust it more when the window-level ratio agrees.",
  },
  // ---- futures OI ----------------------------------------------------------------------
  "oi.value": {
    title: "Futures open interest",
    what: "Number of futures positions still open at the end of the window, and the change since the window started. Overnight OI does not change, so at 09:15 the start is yesterday's close.",
    read: "Rising OI means new positions are being created; falling OI means positions are being closed. Read it together with price, as the build-up card does.",
  },
  "oi.change": {
    title: "OI change speed",
    what: "How large today's OI change in this window is compared with the same window on the last 20 sessions.",
    read: "Above 1.5× means unusually heavy position building or unwinding. It ignores direction, so check whether OI rose or fell.",
  },
  "oi.last5": {
    title: "OI change, last 5 min",
    what: "Open interest added or removed in the last 5-minute bar of the window.",
    read: "A large one-bar change marks the moment a big player opened or closed a position.",
  },
  "oi.buildup": {
    title: "Build-up",
    what: "The classic reading of futures price and OI moving together over the window.",
    read: "Price ↑ OI ↑ long build-up (fresh buying) · Price ↓ OI ↑ short build-up (fresh selling) · Price ↑ OI ↓ short covering · Price ↓ OI ↓ long unwinding.",
  },
  "oi.volume": {
    title: "Futures volume and buy/sell",
    what: "Futures contracts traded in the window, and the estimated buy/sell ratio of that volume.",
    read: "Futures are where leveraged traders act, so a futures volume spike with a one-sided ratio is a strong positioning signal.",
  },
  // ---- option chain / strike OI ------------------------------------------------------------
  "opt.chain": {
    title: "Option chain",
    what: "Calls on the left, puts on the right, strikes in the middle: 10 strikes either side of the at-the-money strike, as they stood at the end of the window. Changes are measured from the window start.",
    read: "Shaded cells are in the money. A × badge marks a cell that is at least 2× its usual value for the same distance from ATM in the same window. Click a row to see that strike through the window.",
  },
  "opt.ce_oi": {
    title: "Call open interest",
    what: "Total open call positions across all strikes of this expiry, and the change since the window started.",
    read: "Rising call OI usually means call writing: sellers expect price to stay below those strikes. The × shows whether today's change is unusually large for this time slot.",
  },
  "opt.pe_oi": {
    title: "Put open interest",
    what: "Total open put positions across all strikes of this expiry, and the change since the window started.",
    read: "Rising put OI usually means put writing: sellers expect price to stay above those strikes. Put writing that grows faster than call writing is read as support building.",
  },
  "opt.max_ce": {
    title: "Highest call OI",
    what: "The strike with the most open calls among the strikes shown.",
    read: "Often acts as resistance: call writers there defend it. A shift of this strike higher during the day is a sign of strength.",
  },
  "opt.max_pe": {
    title: "Highest put OI",
    what: "The strike with the most open puts among the strikes shown.",
    read: "Often acts as support: put writers there defend it. If it moves up during the day, support is rising with price.",
  },
  "opt.build": {
    title: "Biggest OI build-up",
    what: "The single strike and side (CE or PE) where open interest changed the most inside the window.",
    read: "This is where fresh positions are being concentrated right now. Check the × in the chain to see how unusual it is.",
  },
  "opt.chart_oi": {
    title: "OI by strike",
    what: "Calls (vermilion) and puts (teal) for each strike. Choose OI, the change in the window, the last 5 minutes, volume or turnover.",
    read: "Gray ticks are the 20-session average for the same distance from ATM in the same window, so a bar far above its tick is unusual. The vertical line is spot; the small triangle marks max pain.",
  },
  // ---- greeks --------------------------------------------------------------------------------
  "opt.iv": {
    title: "ATM implied volatility",
    what: "The volatility the market is pricing into the at-the-money options at the end of the window (average of CE and PE), and its change since the window started.",
    read: "IV percentile shows where today's IV sits against the last 20 sessions at the same time, and against all history. A high percentile means options are expensive; a low one means they are cheap.",
  },
  "opt.iv_chg": {
    title: "IV change speed",
    what: "How large today's ATM IV change in the window is compared with the same window on the last 20 sessions.",
    read: "A fast IV rise with a falling price signals fear (put buying); a fast IV fall often follows an event or a large move that is over.",
  },
  "opt.delta": {
    title: "Delta (ATM)",
    what: "How much the at-the-money option moves for a ₹1 move in the stock: about +0.5 for the call and −0.5 for the put at the money.",
    read: "A call delta drifting above 0.5 means price has moved up through the strike. Use the chart to see delta across strikes.",
  },
  "opt.gamma": {
    title: "Gamma (ATM)",
    what: "How fast delta changes as the stock moves. It is highest at the money and rises as expiry gets closer.",
    read: "High gamma means option prices swing sharply with small stock moves, and option writers have to hedge more, which can speed up moves near expiry.",
  },
  "opt.theta": {
    title: "Theta (ATM)",
    what: "Premium the option loses per day from time decay alone (negative for buyers).",
    read: "Larger theta than usual means time decay is working harder for sellers. It grows quickly in the last week before expiry.",
  },
  "opt.vega": {
    title: "Vega (ATM)",
    what: "How much the option premium changes for a 1-point change in IV.",
    read: "High vega means the premium depends heavily on IV, so an IV crush hurts buyers more. Vega falls as expiry approaches.",
  },
  "opt.chart_greeks": {
    title: "Greeks by strike",
    what: "IV, delta, gamma, theta or vega for every strike, calls and puts, at the end of the window, or their change since the window started.",
    read: "Gray ticks are the 20-session average at the same distance from ATM and the same time. An IV level that is much higher on puts than calls (skew) shows demand for downside protection.",
  },
  // ---- PCR -----------------------------------------------------------------------------------
  "opt.pcr": {
    title: "Put-call ratio (OI)",
    what: "Total put open interest divided by total call open interest at the end of the window.",
    read: "Above 1 means more puts are open than calls, usually put writers backing support (read as bullish); below 0.7 means call writers dominate. Compare it with this stock's own normal level, shown by the ×.",
  },
  "opt.pcr_chg": {
    title: "PCR change speed",
    what: "How much the PCR moved inside the window compared with the same window on the last 20 sessions.",
    read: "A PCR rising unusually fast means puts are being added faster than calls: support is building quickly.",
  },
  "opt.pcr_vol": {
    title: "Volume PCR",
    what: "Put volume divided by call volume traded inside the window.",
    read: "It shows where today's trading activity is going, rather than the positions that are open. A spike in volume PCR often comes before OI changes.",
  },
  // ---- max pain ------------------------------------------------------------------------------
  "opt.max_pain": {
    title: "Max pain",
    what: "The strike at which option buyers as a whole would lose the most (and writers pay the least) if the stock settled there at expiry.",
    read: "Price often drifts toward max pain into expiry week. A max pain far below spot is a downward pull, and far above is an upward pull.",
  },
  "opt.mp_shift": {
    title: "Max pain shift",
    what: "How far max pain moved during the window, compared with how far it usually moves in the same window.",
    read: "Max pain usually changes slowly. A shift of several strikes in one session means the open positions are being rebuilt.",
  },
  "opt.chart_pain": {
    title: "Writers' payout by strike",
    what: "For every strike: the total amount option writers would have to pay if the stock expired exactly there, from the OI at the end of the window.",
    read: "The lowest bar (highlighted) is max pain. A deep, narrow valley means the market is strongly anchored to that strike; a flat curve means no strong anchor.",
  },
};
