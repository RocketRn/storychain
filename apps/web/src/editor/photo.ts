/** Loads a user photo honoring EXIF orientation and downscales huge images before any drawing. */
export interface Photo {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export const MAX_PHOTO_SIDE = 2560;

export async function loadPhoto(file: Blob): Promise<Photo> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("UNSUPPORTED_IMAGE");
  }
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest > MAX_PHOTO_SIDE) {
    const k = MAX_PHOTO_SIDE / longest;
    const small = await createImageBitmap(bitmap, {
      resizeWidth: Math.round(bitmap.width * k),
      resizeHeight: Math.round(bitmap.height * k),
      resizeQuality: "high",
    });
    bitmap.close();
    bitmap = small;
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
