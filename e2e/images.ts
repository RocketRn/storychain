import sharp from "sharp";

/** A photo with a recognizable layout: left half red, right half blue, with a white dot top-left. */
export async function splitPhoto(
  w: number,
  h: number,
  opts: { orientation?: number } = {},
): Promise<Buffer> {
  const left = await sharp({
    create: { width: Math.floor(w / 2), height: h, channels: 3, background: "#e11d1d" },
  })
    .png()
    .toBuffer();
  const right = await sharp({
    create: { width: w - Math.floor(w / 2), height: h, channels: 3, background: "#1d4ee1" },
  })
    .png()
    .toBuffer();
  let img = sharp({ create: { width: w, height: h, channels: 3, background: "#000" } }).composite([
    { input: left, left: 0, top: 0 },
    { input: right, left: Math.floor(w / 2), top: 0 },
  ]);
  if (opts.orientation) img = img.withMetadata({ orientation: opts.orientation });
  return img.jpeg({ quality: 92 }).toBuffer();
}

/** Noisy gradient so JPEG size is realistic (tests the <3MB target). */
export async function noisyPhoto(w: number, h: number): Promise<Buffer> {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + ((i * 2654435761) >>> 24)) & 255;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}
