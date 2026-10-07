import { FONT_WEIGHTS, type Template } from "@storychain/shared";
import "./fonts.css";

export const canvasFont = (family: string, size: number): string =>
  `${FONT_WEIGHTS[family] ?? 700} ${size}px "${family}", sans-serif`;

/**
 * Canvas silently falls back when a font is not loaded yet, so every font used MUST be awaited first.
 * The sample text is passed so the right unicode-range subset (latin / cyrillic) is fetched.
 */
export async function ensureFonts(families: string[], sampleText: string): Promise<void> {
  const sample = `${sampleText}0123456789#AaЯя`;
  await Promise.all(
    [...new Set(families)].map(async (f) => {
      const loaded = await document.fonts.load(canvasFont(f, 40), sample);
      if (loaded.length === 0) throw new Error(`Font "${f}" failed to load`);
    }),
  );
}

export const fontFor = (template: Template, override?: string | null): string =>
  override || template.fontFamily;
