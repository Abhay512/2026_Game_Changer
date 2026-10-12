import { describe, expect, it } from "vitest";
import { compact, day, duration, num, pct, rupees, tidy, times } from "./format";

describe("format", () => {
  it("uses Indian lakh / crore units", () => {
    expect(compact(4343196)).toBe("43.43 L");
    expect(compact(632_500_000)).toBe("63.25 Cr");
    expect(compact(12_345_678_901)).toBe("1,234.6 Cr");
    expect(compact(52_400)).toBe("52.40 K");
    expect(compact(845)).toBe("845");
    expect(compact(-2_140_500, true)).toBe("−21.41 L");
    expect(rupees(1_989_809_08)).toBe("₹19.90 Cr");
  });

  it("groups digits the Indian way", () => {
    expect(num(1234567.891, 2)).toBe("12,34,567.89");
    expect(num(null)).toBe("—");
  });

  it("formats signed percentages and ratios", () => {
    expect(pct(0.717)).toBe("+0.72%");
    expect(pct(-1.862)).toBe("−1.86%");
    expect(pct(0)).toBe("0.00%");
    expect(times(4.47)).toBe("4.47×");
    expect(times(12.34)).toBe("12.3×");
    expect(times(null)).toBe("—");
  });

  it("tidies axis ticks", () => {
    expect(tidy("40.00 L")).toBe("40 L");
    expect(tidy("₹19.90 Cr")).toBe("₹19.9 Cr");
    expect(tidy("+1.50%")).toBe("+1.5%");
    expect(tidy("1,476.00")).toBe("1,476");
    expect(tidy("0.05%")).toBe("0.05%");
  });

  it("formats days and durations", () => {
    expect(day("2026-01-23")).toBe("23 Jan");
    expect(day("2026-01-23", true)).toBe("Fri, 23 Jan 2026");
    expect(duration(12)).toBe("1h");
    expect(duration(18)).toBe("1h 30m");
    expect(duration(3)).toBe("15m");
  });
});
