import { describe, expect, it } from "vitest";
import { DAY_MS, extendProUntil, shrinkProUntil } from "./pro";

const now = new Date("2026-01-10T12:00:00Z");
const days = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

describe("PRO extension math", () => {
  it("starts from now when never PRO or already expired", () => {
    expect(extendProUntil(now, null, 30)).toEqual(days(now, 30));
    expect(extendProUntil(now, days(now, -5), 30)).toEqual(days(now, 30));
    expect(extendProUntil(now, now, 30)).toEqual(days(now, 30)); // expires exactly now: not active
  });
  it("extends from the current end while PRO is active (no days are lost)", () => {
    const current = days(now, 10);
    expect(extendProUntil(now, current, 30)).toEqual(days(now, 40));
  });
  it("chained purchases accumulate", () => {
    const first = extendProUntil(now, null, 30);
    expect(extendProUntil(now, first, 30)).toEqual(days(now, 60));
  });
  it("shrink revokes exactly one period", () => {
    expect(shrinkProUntil(days(now, 60), 30)).toEqual(days(now, 30));
    expect(shrinkProUntil(null, 30)).toBeNull();
  });
});
