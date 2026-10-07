import {
  CARD_HEIGHT,
  CARD_WIDTH,
  STICKER_H,
  STICKER_W,
  type Decoration,
  type Template,
} from "@storychain/shared/light";
import type { Lang } from "../lib/i18n";
import { translate, translatePlural } from "../lib/i18n";
import { canvasFont, ensureFonts, fontFor } from "./fonts";
import { coverRegion, fitTextLines, gradientLine, type View } from "./layout";
import type { Photo } from "./photo";

export interface CardOptions {
  photo: Photo;
  view: View;
  template: Template;
  /** overrides template.fontFamily */
  fontFamily?: string | null;
  chainTitle: string;
  /** "#N" badge: position at posting time (chain.postsCount + 1 for new posts) */
  position: number;
  /** participants count shown in the sticker (same N) */
  participants: number;
  lang: Lang;
}

const MAX_BYTES = 3 * 1024 * 1024;

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

function drawBackground(ctx: CanvasRenderingContext2D, t: Template): void {
  const bg = t.background;
  if (bg.type === "solid") {
    ctx.fillStyle = bg.color;
  } else {
    const l = gradientLine(CARD_WIDTH, CARD_HEIGHT, bg.angleDeg);
    const g = ctx.createLinearGradient(l.x0, l.y0, l.x1, l.y1);
    for (const [o, c] of bg.stops) g.addColorStop(o, c);
    ctx.fillStyle = g;
  }
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
}

function drawDecoration(ctx: CanvasRenderingContext2D, d: Decoration): void {
  ctx.save();
  switch (d.kind) {
    case "circle":
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "rect":
      ctx.fillStyle = d.color;
      rr(ctx, d.x, d.y, d.w, d.h, d.radius ?? 0);
      ctx.fill();
      break;
    case "glow": {
      const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
      g.addColorStop(0, d.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
      break;
    }
    case "filmHoles": {
      ctx.fillStyle = d.color;
      const x = d.side === "left" ? 52 : CARD_WIDTH - 52 - 44;
      for (let y = 20; y < CARD_HEIGHT; y += 112) {
        rr(ctx, x, y, 44, 64, 10);
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

function drawPhoto(ctx: CanvasRenderingContext2D, o: CardOptions): void {
  const f = o.template.photoFrame;
  const { photo } = o;
  ctx.save();
  ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
  ctx.rotate((f.rotationDeg * Math.PI) / 180);
  const b = f.border?.width ?? 0;
  // soft shadow + border plate
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = f.border?.color ?? "#000";
  rr(ctx, -f.w / 2 - b, -f.h / 2 - b, f.w + 2 * b, f.h + 2 * b, f.radius + b);
  ctx.fill();
  ctx.shadowColor = "transparent";
  rr(ctx, -f.w / 2, -f.h / 2, f.w, f.h, f.radius);
  ctx.clip();
  const r = coverRegion(photo.width, photo.height, f.w, f.h, o.view);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo.bitmap, r.sx, r.sy, r.sw, r.sh, -f.w / 2, -f.h / 2, f.w, f.h);
  ctx.restore();
}

function drawLinkIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  rr(ctx, -26, -11, 32, 22, 11);
  ctx.stroke();
  rr(ctx, -6, -11, 32, 22, 11);
  ctx.stroke();
  ctx.restore();
}

function drawSticker(ctx: CanvasRenderingContext2D, o: CardOptions, font: string): void {
  const s = o.template.stickerStyle;
  const x = (CARD_WIDTH - STICKER_W) / 2;
  const y = s.y;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.3)";
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = s.fill;
  rr(ctx, x, y, STICKER_W, STICKER_H, s.radius);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.textBaseline = "middle";
  const padL = 56;
  // icon + "Your turn"
  ctx.fillStyle = s.accent;
  ctx.beginPath();
  ctx.arc(x + padL + 34, y + 66, 34, 0, Math.PI * 2);
  ctx.fill();
  drawLinkIcon(ctx, x + padL + 34, y + 66, s.fill);
  ctx.fillStyle = s.text;
  ctx.font = canvasFont(font, 46);
  ctx.fillText(translate(o.lang, "stickerYourTurn"), x + padL + 34 * 2 + 22, y + 66);

  // participants counter (muted)
  ctx.globalAlpha = 0.6;
  ctx.font = canvasFont(font, 30);
  ctx.fillText(translatePlural(o.lang, "participants", o.participants), x + padL, y + 136);
  ctx.globalAlpha = 1;

  // chain title: up to 2 lines, auto-shrink, ellipsis
  const badgeR = 74;
  const titleW = STICKER_W - padL - 40 - badgeR * 2 - 40;
  const measure = (text: string, size: number) => {
    ctx.font = canvasFont(font, size);
    return ctx.measureText(text).width;
  };
  const fit = fitTextLines(measure, o.chainTitle, titleW, {
    maxLines: 2,
    maxSize: 54,
    minSize: 28,
  });
  ctx.font = canvasFont(font, fit.size);
  ctx.fillStyle = s.text;
  const lh = fit.size * 1.18;
  const blockTop = y + 184 + (2 - fit.lines.length) * (lh / 2);
  fit.lines.forEach((line, i) => ctx.fillText(line, x + padL, blockTop + lh * (i + 0.5) - 6));

  // "#N" badge
  const bx = x + STICKER_W - 40 - badgeR;
  const by = y + STICKER_H / 2 + 6;
  ctx.fillStyle = s.accent;
  ctx.beginPath();
  ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = s.fill;
  ctx.textAlign = "center";
  const label = `#${o.position}`;
  const badgeFit = fitTextLines(measure, label, badgeR * 2 - 28, {
    maxLines: 1,
    maxSize: 56,
    minSize: 24,
  });
  ctx.font = canvasFont(font, badgeFit.size);
  ctx.fillText(label, bx, by + 2);
  ctx.restore();
}

/** Draws the full card in 1080x1920 card space, scaled by `scale` (preview/thumbnail use < 1). Synchronous: fonts must be loaded. */
export function drawCard(ctx: CanvasRenderingContext2D, o: CardOptions, scale = 1): void {
  ctx.save();
  ctx.scale(scale, scale);
  drawBackground(ctx, o.template);
  // decorations first (some sit behind the photo); film holes etc. are plain shapes
  o.template.decorations.forEach((d) => drawDecoration(ctx, d));
  drawPhoto(ctx, o);
  drawSticker(ctx, o, fontFor(o.template, o.fontFamily));
  ctx.restore();
}

export const fontsNeeded = (o: Pick<CardOptions, "template" | "fontFamily">): string[] => [
  fontFor(o.template, o.fontFamily),
];

export async function prepareFonts(o: CardOptions): Promise<void> {
  await ensureFonts(
    fontsNeeded(o),
    `${o.chainTitle} ${translate(o.lang, "stickerYourTurn")} ${translatePlural(o.lang, "participants", o.participants)}`,
  );
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality,
    ),
  );
}

/**
 * Renders the final card: exactly 1080x1920 JPEG (~q0.9, lowered only if the result exceeds 3 MB).
 * The watermark is NOT drawn here: the server adds it for free users.
 */
export async function renderCard(options: CardOptions): Promise<Blob> {
  await prepareFonts(options);
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");
  drawCard(ctx, options, 1);
  let blob = await toBlob(canvas, 0.9);
  for (const q of [0.82, 0.74, 0.66]) {
    if (blob.size <= MAX_BYTES) break;
    blob = await toBlob(canvas, q);
  }
  return blob;
}
