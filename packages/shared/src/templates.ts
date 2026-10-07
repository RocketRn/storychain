/** Data-driven card templates. Rendering lives in apps/web/src/editor. Canvas is 1080x1920. */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1920;
/** Telegram story UI overlays top/bottom; keep important content out of these bands. */
export const SAFE_TOP = 250;
export const SAFE_BOTTOM = 250;

export interface GradientBg {
  type: "gradient";
  angleDeg: number;
  stops: Array<[number, string]>;
}
export interface SolidBg {
  type: "solid";
  color: string;
}
export type TemplateBackground = GradientBg | SolidBg;

export interface PhotoFrame {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  rotationDeg: number;
  /** optional border drawn around the photo */
  border?: { width: number; color: string };
}

export interface StickerStyle {
  /** where the "Your turn" sticker is anchored: y of its top edge */
  y: number;
  fill: string;
  text: string;
  accent: string;
  radius: number;
}

export interface Palette {
  text: string;
  mutedText: string;
  accent: string;
}

export type Decoration =
  | { kind: "circle"; x: number; y: number; r: number; color: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; radius?: number }
  | { kind: "filmHoles"; side: "left" | "right"; color: string }
  | { kind: "glow"; x: number; y: number; r: number; color: string };

export interface Template {
  id: string;
  name: string;
  isPremium: boolean;
  background: TemplateBackground;
  photoFrame: PhotoFrame;
  stickerStyle: StickerStyle;
  palette: Palette;
  fontFamily: string;
  decorations: Decoration[];
}

const frame = (over: Partial<PhotoFrame> = {}): PhotoFrame => ({
  x: 90,
  y: 330,
  w: 900,
  h: 1000,
  radius: 48,
  rotationDeg: 0,
  ...over,
});

const sticker = (over: Partial<StickerStyle> = {}): StickerStyle => ({
  y: 1400,
  fill: "#ffffff",
  text: "#111111",
  accent: "#ff3d71",
  radius: 80,
  ...over,
});

export const TEMPLATES: readonly Template[] = [
  {
    id: "sunset",
    name: "Sunset",
    isPremium: false,
    background: { type: "gradient", angleDeg: 160, stops: [[0, "#ff9a62"], [1, "#c13584"]] },
    photoFrame: frame(),
    stickerStyle: sticker(),
    palette: { text: "#ffffff", mutedText: "#ffe5d6", accent: "#ffffff" },
    fontFamily: "Inter",
    decorations: [{ kind: "circle", x: 920, y: 300, r: 140, color: "rgba(255,255,255,0.12)" }],
  },
  {
    id: "ocean",
    name: "Ocean",
    isPremium: false,
    background: { type: "gradient", angleDeg: 180, stops: [[0, "#2193b0"], [1, "#0b3d63"]] },
    photoFrame: frame({ radius: 64 }),
    stickerStyle: sticker({ accent: "#2193b0" }),
    palette: { text: "#ffffff", mutedText: "#cfe9f3", accent: "#ffffff" },
    fontFamily: "Manrope",
    decorations: [{ kind: "circle", x: 140, y: 1700, r: 180, color: "rgba(255,255,255,0.08)" }],
  },
  {
    id: "minimal-light",
    name: "Minimal",
    isPremium: false,
    background: { type: "solid", color: "#f4f1ea" },
    photoFrame: frame({ radius: 12 }),
    stickerStyle: sticker({ fill: "#111111", text: "#ffffff", accent: "#f4f1ea" }),
    palette: { text: "#111111", mutedText: "#555555", accent: "#111111" },
    fontFamily: "Inter",
    decorations: [],
  },
  {
    id: "polaroid",
    name: "Polaroid",
    isPremium: false,
    background: { type: "solid", color: "#2b2b2f" },
    photoFrame: frame({ x: 120, y: 330, w: 840, h: 1000, radius: 8, rotationDeg: -3, border: { width: 36, color: "#ffffff" } }),
    stickerStyle: sticker({ accent: "#ffb703" }),
    palette: { text: "#ffffff", mutedText: "#cccccc", accent: "#ffb703" },
    fontFamily: "Manrope",
    decorations: [],
  },
  {
    id: "neon",
    name: "Neon",
    isPremium: true,
    background: { type: "gradient", angleDeg: 180, stops: [[0, "#0f0c29"], [1, "#24243e"]] },
    photoFrame: frame({ radius: 40, border: { width: 8, color: "#00f5d4" } }),
    stickerStyle: sticker({ fill: "#0f0c29", text: "#00f5d4", accent: "#f15bb5" }),
    palette: { text: "#00f5d4", mutedText: "#9b8cff", accent: "#f15bb5" },
    fontFamily: "Space Grotesk",
    decorations: [
      { kind: "glow", x: 540, y: 830, r: 700, color: "rgba(241,91,181,0.18)" },
    ],
  },
  {
    id: "film-strip",
    name: "Film strip",
    isPremium: true,
    background: { type: "solid", color: "#111111" },
    photoFrame: frame({ x: 150, w: 780, radius: 4 }),
    stickerStyle: sticker({ accent: "#ffcc00" }),
    palette: { text: "#ffffff", mutedText: "#bbbbbb", accent: "#ffcc00" },
    fontFamily: "Bebas Neue",
    decorations: [
      { kind: "filmHoles", side: "left", color: "#f4f1ea" },
      { kind: "filmHoles", side: "right", color: "#f4f1ea" },
    ],
  },
  {
    id: "aurora",
    name: "Aurora",
    isPremium: true,
    background: { type: "gradient", angleDeg: 135, stops: [[0, "#00c9ff"], [0.5, "#7b2ff7"], [1, "#f107a3"]] },
    photoFrame: frame({ radius: 120 }),
    stickerStyle: sticker({ accent: "#7b2ff7" }),
    palette: { text: "#ffffff", mutedText: "#f1d9ff", accent: "#ffffff" },
    fontFamily: "Playfair Display",
    decorations: [{ kind: "circle", x: 900, y: 1750, r: 220, color: "rgba(255,255,255,0.1)" }],
  },
  {
    id: "retro-pop",
    name: "Retro pop",
    isPremium: true,
    background: { type: "solid", color: "#ffd23f" },
    photoFrame: frame({ radius: 24, rotationDeg: 2, border: { width: 14, color: "#111111" } }),
    stickerStyle: sticker({ fill: "#ee4266", text: "#ffffff", accent: "#111111" }),
    palette: { text: "#111111", mutedText: "#3b3b3b", accent: "#ee4266" },
    fontFamily: "Pacifico",
    decorations: [{ kind: "rect", x: 60, y: 300, w: 960, h: 1060, color: "#111111", radius: 36 }],
  },
];

export function getTemplate(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export const FREE_FONTS = ["Inter", "Manrope"] as const;
export const PREMIUM_FONTS = ["Space Grotesk", "Bebas Neue", "Playfair Display", "Pacifico"] as const;
