import { fileURLToPath } from "node:url";
import sharp, { type Metadata } from "sharp";
import { CARD_HEIGHT, CARD_WIDTH } from "@storychain/shared";
import { AppError, errors } from "../errors";

const FONT_FILE = fileURLToPath(new URL("../../assets/fonts/Inter_700Bold.ttf", import.meta.url));

export interface ProcessedImage {
  image: Buffer;
  thumb: Buffer;
}

/**
 * Verifies magic bytes via sharp (not the client mime), enforces exact 1080x1920,
 * re-encodes to JPEG (strips metadata), optionally applies the watermark, builds the thumbnail.
 */
export async function processUpload(
  input: Buffer,
  opts: { watermark: boolean },
): Promise<ProcessedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw errors.invalidImage("Not a valid image");
  }
  if (meta.format !== "jpeg" && meta.format !== "png")
    throw errors.invalidImage("Only JPEG/PNG allowed");
  if (meta.width !== CARD_WIDTH || meta.height !== CARD_HEIGHT) {
    throw errors.invalidImage(`Image must be exactly ${CARD_WIDTH}x${CARD_HEIGHT}`);
  }

  try {
    let pipeline = sharp(input, { limitInputPixels: 40_000_000 }).flatten({
      background: "#000000",
    });
    if (opts.watermark)
      pipeline = pipeline.composite([{ input: await watermarkPng(), gravity: "southeast" }]);
    // Watermark is composited onto the decoded pixels, then encoded once.
    const image = await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const thumb = await sharp(image).resize({ width: 360 }).jpeg({ quality: 78 }).toBuffer();
    return { image, thumb };
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw errors.invalidImage("Could not process image");
  }
}

let wmCache: Buffer | undefined;

/** Subtle "StoryChain" pill in the bottom-right corner. Rendered once with a bundled OFL font. */
export async function watermarkPng(): Promise<Buffer> {
  if (wmCache) return wmCache;
  const text = await sharp({
    text: {
      text: '<span foreground="white">StoryChain</span>',
      font: "Inter Bold 34",
      fontfile: FONT_FILE,
      rgba: true,
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
  const tm = await sharp(text).metadata();
  const w = (tm.width ?? 200) + 48;
  const h = (tm.height ?? 40) + 24;
  const pill = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${h / 2}" fill="rgba(0,0,0,0.45)"/></svg>`,
  );
  // Margin keeps it inside Telegram's bottom overlay area but away from the edges
  const margin = 40;
  wmCache = await sharp({
    create: {
      width: w + margin,
      height: h + margin + 180,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: pill, left: 0, top: 0 },
      { input: text, left: 24, top: 12 },
    ])
    .png()
    .toBuffer();
  return wmCache;
}
