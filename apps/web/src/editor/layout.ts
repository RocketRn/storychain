/** Pure layout math for the card editor (no DOM) so it is unit-testable. */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/** Viewport into the photo: zoom >= 1 over "cover" scale; (cx, cy) = normalized center in source space [0..1]. */
export interface View {
  zoom: number;
  cx: number;
  cy: number;
}
export const DEFAULT_VIEW: View = { zoom: 1, cx: 0.5, cy: 0.5 };

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Source rectangle to draw into a frame of frameW x frameH (cover fit + zoom + pan, always inside the image). */
export function coverRegion(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
  view: View,
): SourceRect {
  const scale = Math.max(frameW / srcW, frameH / srcH) * clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
  const sw = frameW / scale;
  const sh = frameH / scale;
  const cx = clamp(view.cx * srcW, sw / 2, Math.max(sw / 2, srcW - sw / 2));
  const cy = clamp(view.cy * srcH, sh / 2, Math.max(sh / 2, srcH - sh / 2));
  return { sx: cx - sw / 2, sy: cy - sh / 2, sw, sh };
}

/** Re-derives a valid (clamped) view so stored state never drifts outside the image. */
export function normalizeView(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
  view: View,
): View {
  const r = coverRegion(srcW, srcH, frameW, frameH, view);
  return {
    zoom: clamp(view.zoom, MIN_ZOOM, MAX_ZOOM),
    cx: (r.sx + r.sw / 2) / srcW,
    cy: (r.sy + r.sh / 2) / srcH,
  };
}

/** Drag by (dx, dy) measured in card pixels (the frame's coordinate space): the photo follows the finger. */
export function panView(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
  view: View,
  dx: number,
  dy: number,
): View {
  const r = coverRegion(srcW, srcH, frameW, frameH, view);
  const srcPerCard = r.sw / frameW;
  return normalizeView(srcW, srcH, frameW, frameH, {
    zoom: view.zoom,
    cx: (r.sx + r.sw / 2 - dx * srcPerCard) / srcW,
    cy: (r.sy + r.sh / 2 - dy * srcPerCard) / srcH,
  });
}

export function zoomView(
  srcW: number,
  srcH: number,
  frameW: number,
  frameH: number,
  view: View,
  factor: number,
): View {
  return normalizeView(srcW, srcH, frameW, frameH, { ...view, zoom: view.zoom * factor });
}

/** CSS-like linear-gradient line: angle 0 = to top, 90 = to right, 180 = to bottom. */
export function gradientLine(w: number, h: number, angleDeg: number) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

export type Measure = (text: string, size: number) => number;

/** Longest prefix of `text` (plus "…") that fits maxWidth. */
export function ellipsize(measure: Measure, text: string, size: number, maxWidth: number): string {
  if (measure(text, size) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(text.slice(0, mid).trimEnd() + "…", size) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

function wrap(measure: Measure, words: string[], size: number, maxWidth: number): string[] | null {
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (measure(w, size) > maxWidth) return null; // a single word does not fit at this size
    const next = line ? `${line} ${w}` : w;
    if (measure(next, size) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface FittedText {
  size: number;
  lines: string[];
}

/**
 * Largest font size in [minSize, maxSize] at which `text` wraps into <= maxLines lines of <= maxWidth.
 * If nothing fits even at minSize the text is truncated with an ellipsis (never overflows).
 */
export function fitTextLines(
  measure: Measure,
  text: string,
  maxWidth: number,
  opts: { maxLines: number; maxSize: number; minSize: number; step?: number },
): FittedText {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return { size: opts.maxSize, lines: [] };
  const words = clean.split(" ");
  const step = opts.step ?? 2;
  for (let size = opts.maxSize; size >= opts.minSize; size -= step) {
    const lines = wrap(measure, words, size, maxWidth);
    if (lines && lines.length <= opts.maxLines) return { size, lines };
  }
  // Fallback at minSize: fill lines greedily, ellipsize the last allowed line.
  const size = opts.minSize;
  const lines: string[] = [];
  let rest = words;
  for (let i = 0; i < opts.maxLines && rest.length; i++) {
    if (i === opts.maxLines - 1) {
      lines.push(ellipsize(measure, rest.join(" "), size, maxWidth));
      break;
    }
    let line = "";
    let used = 0;
    for (const w of rest) {
      const next = line ? `${line} ${w}` : w;
      if (measure(next, size) > maxWidth) break;
      line = next;
      used++;
    }
    if (!line) {
      lines.push(ellipsize(measure, rest[0] as string, size, maxWidth)); // single overlong word
      break;
    }
    lines.push(line);
    rest = rest.slice(used);
  }
  return { size, lines };
}
