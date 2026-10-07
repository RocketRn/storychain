import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/ttlCache";

describe("TtlCache", () => {
  it("returns values until they expire", () => {
    let t = 1_000;
    const c = new TtlCache<string>({ maxEntries: 10, ttlMs: 100, now: () => t });
    c.set("a", "A");
    expect(c.get("a")).toBe("A");
    t += 99;
    expect(c.get("a")).toBe("A");
    t += 1;
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0); // expired entries are dropped on access
  });

  it("is bounded: the oldest entry makes room, so caller-chosen keys cannot grow it without limit", () => {
    const c = new TtlCache<number>({ maxEntries: 3, ttlMs: 60_000 });
    for (let i = 0; i < 1000; i++) c.set(`k${i}`, i);
    expect(c.size).toBe(3);
    expect(c.get("k999")).toBe(999);
    expect(c.get("k997")).toBe(997);
    expect(c.get("k996")).toBeUndefined();
  });

  it("re-setting a key makes it the newest and restarts its clock", () => {
    let t = 0;
    const c = new TtlCache<string>({ maxEntries: 2, ttlMs: 100, now: () => t });
    c.set("a", "1");
    c.set("b", "2");
    t = 80;
    c.set("a", "1b"); // a is now the newest
    c.set("c", "3"); // evicts b, not a
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("1b");
    t = 150; // past a's ORIGINAL expiry (100), inside its refreshed one (180)
    expect(c.get("a")).toBe("1b");
    t = 181;
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toBeUndefined();
  });
});
