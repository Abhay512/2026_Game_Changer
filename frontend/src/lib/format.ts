/** Number formatting in Indian conventions: lakh (L) and crore (Cr), en-IN digit grouping. */

const nfCache = new Map<number, Intl.NumberFormat>();
function nf(decimals: number) {
  let f = nfCache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    nfCache.set(decimals, f);
  }
  return f;
}

const DASH = "—";
const MINUS = "−"; // typographic minus

export function isNum(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function withSign(s: string, n: number, sign: boolean) {
  if (n < 0) return MINUS + s;
  return sign && n > 0 ? "+" + s : s;
}

/** 12,34,567.89 */
export function num(n: number | null | undefined, decimals = 0, sign = false): string {
  if (!isNum(n)) return DASH;
  return withSign(nf(decimals).format(Math.abs(n)), n, sign);
}

/** 43.43 L · 6.32 Cr · 12.5 K · 845 */
export function compact(n: number | null | undefined, sign = false): string {
  if (!isNum(n)) return DASH;
  const a = Math.abs(n);
  let s: string;
  if (a >= 1e7) s = `${trim(a / 1e7)} Cr`;
  else if (a >= 1e5) s = `${trim(a / 1e5)} L`;
  else if (a >= 1e3) s = `${trim(a / 1e3)} K`;
  else s = nf(a < 10 && a % 1 ? 2 : 0).format(a);
  return withSign(s, n, sign);
}

function trim(v: number): string {
  return nf(v >= 100 ? 1 : 2).format(v);
}

export function rupees(n: number | null | undefined, sign = false): string {
  if (!isNum(n)) return DASH;
  return withSign("₹" + compact(Math.abs(n)), n, sign);
}

export function price(n: number | null | undefined, sign = false): string {
  return num(n, 2, sign);
}

/** +0.72% */
export function pct(n: number | null | undefined, decimals = 2, sign = true): string {
  if (!isNum(n)) return DASH;
  return withSign(`${nf(decimals).format(Math.abs(n))}%`, n, sign);
}

/** 4.47× */
export function times(x: number | null | undefined): string {
  if (!isNum(x)) return DASH;
  return `${nf(x >= 100 ? 0 : x >= 10 ? 1 : 2).format(x)}×`;
}

export function ordinalPct(p: number | null | undefined): string {
  return isNum(p) ? `P${Math.round(p)}` : DASH;
}

export function direction(n: number | null | undefined): "up" | "down" | "flat" {
  if (!isNum(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-01-23" → "23 Jan" (short) / "Fri, 23 Jan 2026" (long) */
export function day(iso: string | null | undefined, long = false): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.split("-").map(Number);
  if (!long) return `${d} ${MONTHS[m - 1]}`;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export function monthName(m: number): string {
  return MONTHS[m];
}

/** Bar-length label for a window: "1h 30m", "15m" */
export function duration(bars: number, barMinutes = 5): string {
  const m = bars * barMinutes;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

/** Axis ticks don't need trailing zeros: "40.00 L" → "40 L", "1.50%" → "1.5%". */
export function tidy(s: string): string {
  return s.replace(/(\d)\.0+(?!\d)/g, "$1").replace(/(\.\d*?[1-9])0+(?!\d)/g, "$1");
}
