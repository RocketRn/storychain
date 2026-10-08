import { describe, expect, it } from "vitest";
import { sanitizeText } from "./helpers";
import {
  createChainSchema,
  createPostFieldsSchema,
  patchChainSchema,
  reportSchema,
} from "./schemas";

const RLO = "‮";
const ZWSP = "​";

describe("sanitizeText", () => {
  it("removes direction overrides/isolates and marks (they visually reverse what follows)", () => {
    expect(sanitizeText(`Cats ${RLO}gnp.exe`)).toBe("Cats gnp.exe");
    for (const c of ["‪", "‫", "‬", "‭", "⁦", "⁧", "⁨", "⁩", "‎", "‏", "؜"])
      expect(sanitizeText(`a${c}b`), c.codePointAt(0)?.toString(16)).toBe("ab");
  });

  it("removes invisible characters and control codes; line breaks and tabs become spaces", () => {
    expect(sanitizeText(`${ZWSP}${ZWSP}${ZWSP}`)).toBe("");
    expect(sanitizeText("a⁠b﻿c᠎d\u0000e\u0007f\u009Bg")).toBe("abcdefg");
    expect(sanitizeText("  line\none\r\ntwo\tthree   four  ")).toBe("line one two three four");
  });

  it("keeps what real text needs: emoji sequences (ZWJ), ZWNJ, variation selectors, flags, RTL scripts", () => {
    const family = "👨‍👩‍👧";
    const persian = "می‌خواهم"; // ZWNJ is part of correct Persian spelling
    const scotland = "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}"; // tag characters
    const heart = "❤️";
    const arabic = "مرحبا";
    for (const t of [family, persian, scotland, heart, arabic, "Привет"])
      expect(sanitizeText(t)).toBe(t);
  });

  it("normalizes to NFC (one spelling for the same text)", () => {
    expect(sanitizeText("é")).toBe("é");
  });

  it("multiline keeps single line breaks, caps blank lines and trims each line", () => {
    expect(sanitizeText("  a  \n\n\n\n b‮ \r\nc", { multiline: true })).toBe("a\n\nb\nc");
  });
});

describe("schemas validate the VISIBLE text", () => {
  it("a title made of invisible characters is too short, not a valid title", () => {
    expect(createChainSchema.safeParse({ title: `${ZWSP}${ZWSP}${ZWSP}${ZWSP}` }).success).toBe(
      false,
    );
    expect(createChainSchema.safeParse({ title: `a${ZWSP}b${ZWSP}` }).success).toBe(false);
    expect(createChainSchema.safeParse({ title: `${RLO}${RLO}${RLO}ab` }).success).toBe(false);
  });

  it("stores the cleaned text", () => {
    const r = createChainSchema.parse({
      title: `Show ${RLO}your\ncat`,
      description: `Line 1${ZWSP}\n\n\n\nLine 2`,
      emoji: "🐱​",
    });
    expect(r).toEqual({ title: "Show your cat", description: "Line 1\n\nLine 2", emoji: "🐱" });
    expect(patchChainSchema.parse({ description: `x${RLO}y` })).toEqual({ description: "xy" });
    expect(
      createPostFieldsSchema.parse({ templateId: "sunset", caption: `hi${RLO} there` }).caption,
    ).toBe("hi there");
    expect(
      reportSchema.safeParse({ chainId: "abc12345", reason: `${ZWSP}${ZWSP}${ZWSP}` }).success,
    ).toBe(false);
  });

  it("length limits apply after cleaning (padding with invisible characters does not eat the limit)", () => {
    const title = "x".repeat(80) + ZWSP.repeat(20);
    expect(createChainSchema.parse({ title }).title).toHaveLength(80);
  });
});
