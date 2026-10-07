import { describe, expect, it } from "vitest";
import { fromUnits, toUnits } from "./units";

describe("toUnits", () => {
  it("converts whole numbers", () => expect(toUnits("100", 9)).toBe(100000000000n));
  it("handles fractions", () => {
    expect(toUnits("0.5", 9)).toBe(500000000n);
    expect(toUnits("1.000000001", 9)).toBe(1000000001n);
  });
  it("handles large values without precision loss", () => {
    expect(toUnits("123456789012345678.123456789", 9)).toBe(123456789012345678123456789n);
  });
  it("accepts extra zero decimals but rejects lossy ones", () => {
    expect(toUnits("1.5000000000", 9)).toBe(1500000000n);
    expect(() => toUnits("1.0000000001", 9)).toThrow();
  });
  it("rejects garbage", () => {
    for (const bad of ["", "abc", "-1", "1e3", "1.", ".5", "1,5"]) expect(() => toUnits(bad, 9)).toThrow();
  });
  it("works with 0 decimals", () => expect(toUnits("150", 0)).toBe(150n));
});

describe("fromUnits", () => {
  it("formats", () => {
    expect(fromUnits(100000000000n, 9)).toBe("100");
    expect(fromUnits(500000000n, 9)).toBe("0.5");
    expect(fromUnits("1", 9)).toBe("0.000000001");
    expect(fromUnits(0n, 9)).toBe("0");
    expect(fromUnits(123456789012345678123456789n, 9)).toBe("123456789012345678.123456789");
  });
  it("round-trips", () => {
    for (const v of ["0", "0.5", "42.123456789", "999999999999.000000001"]) {
      expect(fromUnits(toUnits(v, 9), 9)).toBe(v);
    }
  });
});
