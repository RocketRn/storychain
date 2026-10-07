import { describe, expect, it } from "vitest";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  ALL_FONTS,
  SAFE_BOTTOM,
  SAFE_TOP,
  STICKER_H,
  STICKER_W,
  TEMPLATES,
  FONT_WEIGHTS,
} from "@storychain/shared/light";
import {
  clamp,
  coverRegion,
  DEFAULT_VIEW,
  ellipsize,
  fitTextLines,
  gradientLine,
  MAX_ZOOM,
  panView,
  zoomView,
  type Measure,
} from "./layout";

// Fake monospace-ish metrics: every char is 0.5em wide
const measure: Measure = (t, size) => t.length * size * 0.5;

describe("coverRegion", () => {
  it("covers a wide photo in a portrait frame, centered", () => {
    const r = coverRegion(4000, 3000, 900, 960, DEFAULT_VIEW);
    // scale = max(0.225, 0.32) = 0.32 -> region 2812.5 x 3000
    expect(r.sh).toBeCloseTo(3000);
    expect(r.sw).toBeCloseTo(900 / 0.32);
    expect(r.sx + r.sw / 2).toBeCloseTo(2000);
    expect(r.sy).toBeCloseTo(0);
  });
  it("covers a tall photo in the frame", () => {
    const r = coverRegion(1000, 4000, 900, 960, DEFAULT_VIEW);
    expect(r.sw).toBeCloseTo(1000);
    expect(r.sh).toBeCloseTo((960 / 900) * 1000);
    expect(r.sy + r.sh / 2).toBeCloseTo(2000);
  });
  it("preserves the frame aspect ratio at any zoom and stays inside the image", () => {
    for (const zoom of [1, 1.7, 3, MAX_ZOOM, 99]) {
      for (const [cx, cy] of [
        [0, 0],
        [1, 1],
        [0.5, 0.3],
        [-4, 9],
      ] as const) {
        const r = coverRegion(3000, 2000, 900, 960, { zoom, cx, cy });
        expect(r.sw / r.sh).toBeCloseTo(900 / 960);
        expect(r.sx).toBeGreaterThanOrEqual(-1e-9);
        expect(r.sy).toBeGreaterThanOrEqual(-1e-9);
        expect(r.sx + r.sw).toBeLessThanOrEqual(3000 + 1e-9);
        expect(r.sy + r.sh).toBeLessThanOrEqual(2000 + 1e-9);
      }
    }
  });
  it("handles a photo exactly matching the frame aspect", () => {
    const r = coverRegion(900, 960, 900, 960, DEFAULT_VIEW);
    expect(r).toEqual({ sx: 0, sy: 0, sw: 900, sh: 960 });
  });
});

describe("pan / zoom", () => {
  it("does not move when there is nothing to pan (zoom 1 on matching aspect)", () => {
    const v = panView(900, 960, 900, 960, DEFAULT_VIEW, 200, -50);
    expect(v.cx).toBeCloseTo(0.5);
    expect(v.cy).toBeCloseTo(0.5);
  });
  it("dragging right reveals the left part of the photo", () => {
    const v = panView(4000, 3000, 900, 960, DEFAULT_VIEW, 100, 0);
    expect(v.cx).toBeLessThan(0.5);
  });
  it("clamps panning at the edges", () => {
    const v = panView(4000, 3000, 900, 960, DEFAULT_VIEW, 1e6, 1e6);
    const r = coverRegion(4000, 3000, 900, 960, v);
    expect(r.sx).toBeCloseTo(0);
    expect(v.cx).toBeGreaterThan(0);
  });
  it("zoom is clamped to [1, MAX_ZOOM]", () => {
    expect(zoomView(4000, 3000, 900, 960, DEFAULT_VIEW, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomView(4000, 3000, 900, 960, DEFAULT_VIEW, 0.01).zoom).toBe(1);
  });
  it("clamp helper", () =>
    expect([clamp(5, 0, 3), clamp(-1, 0, 3), clamp(2, 0, 3)]).toEqual([3, 0, 2]));
});

describe("gradientLine", () => {
  it("180deg goes top to bottom", () => {
    const g = gradientLine(100, 200, 180);
    expect(g.x0).toBeCloseTo(50);
    expect(g.x1).toBeCloseTo(50);
    expect(g.y0).toBeCloseTo(0);
    expect(g.y1).toBeCloseTo(200);
  });
  it("90deg goes left to right", () => {
    const g = gradientLine(100, 200, 90);
    expect([g.x0, g.x1]).toEqual([0, 100].map((n) => expect.closeTo(n)));
  });
});

describe("fitTextLines", () => {
  it("uses the max size for short text on one line", () => {
    expect(
      fitTextLines(measure, "Show your cat", 600, { maxLines: 2, maxSize: 52, minSize: 30 }),
    ).toEqual({
      size: 52,
      lines: ["Show your cat"],
    });
  });
  it("shrinks and wraps long titles without overflow", () => {
    const t = "Your desk right now with your morning coffee";
    const r = fitTextLines(measure, t, 600, { maxLines: 2, maxSize: 52, minSize: 30 });
    expect(r.lines.length).toBeLessThanOrEqual(2);
    expect(r.size).toBeLessThan(52);
    for (const l of r.lines) expect(measure(l, r.size)).toBeLessThanOrEqual(600);
    expect(r.lines.join(" ")).toBe(t);
  });
  it("truncates with an ellipsis when nothing fits at the min size", () => {
    const t =
      "Очень длинное название цепочки которое никак не помещается в две строки даже на минимальном размере шрифта вообще";
    const r = fitTextLines(measure, t, 400, { maxLines: 2, maxSize: 52, minSize: 30 });
    expect(r.size).toBe(30);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[1]?.endsWith("…")).toBe(true);
    for (const l of r.lines) expect(measure(l, r.size)).toBeLessThanOrEqual(400);
  });
  it("handles a single overlong word", () => {
    const r = fitTextLines(measure, "A".repeat(80), 400, { maxLines: 2, maxSize: 52, minSize: 30 });
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]?.endsWith("…")).toBe(true);
    expect(measure(r.lines[0] as string, r.size)).toBeLessThanOrEqual(400);
  });
  it("normalizes whitespace and handles empty text", () => {
    expect(
      fitTextLines(measure, "  a   b ", 600, { maxLines: 1, maxSize: 40, minSize: 20 }).lines,
    ).toEqual(["a b"]);
    expect(
      fitTextLines(measure, "   ", 600, { maxLines: 1, maxSize: 40, minSize: 20 }).lines,
    ).toEqual([]);
  });
  it("ellipsize keeps short text intact", () =>
    expect(ellipsize(measure, "hi", 10, 100)).toBe("hi"));
});

describe("templates data", () => {
  it("ships 8 templates with unique ids and NO premium/locked flag at all", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) expect(Object.keys(t)).not.toContain("isPremium");
  });
  it("ships 6 fonts, all available to everyone and all with a self-hosted weight", () => {
    expect(ALL_FONTS.length).toBeGreaterThanOrEqual(6);
    for (const f of ALL_FONTS) expect(FONT_WEIGHTS[f]).toBeDefined();
    for (const t of TEMPLATES) expect(ALL_FONTS).toContain(t.fontFamily);
  });
  it("keeps photo frame and sticker inside the Telegram safe zones", () => {
    for (const t of TEMPLATES) {
      const b = t.photoFrame.border?.width ?? 0;
      expect(t.photoFrame.y - b).toBeGreaterThanOrEqual(SAFE_TOP - 1);
      expect(t.photoFrame.y + t.photoFrame.h + b).toBeLessThanOrEqual(t.stickerStyle.y);
      expect(t.stickerStyle.y).toBeGreaterThanOrEqual(SAFE_TOP);
      expect(t.stickerStyle.y + STICKER_H).toBeLessThanOrEqual(CARD_HEIGHT - SAFE_BOTTOM);
      expect(t.photoFrame.x).toBeGreaterThanOrEqual(0);
      expect(t.photoFrame.x + t.photoFrame.w).toBeLessThanOrEqual(CARD_WIDTH);
      expect(STICKER_W).toBeLessThanOrEqual(CARD_WIDTH);
    }
  });
});
