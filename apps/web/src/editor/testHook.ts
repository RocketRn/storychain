/** Exposes renderCard to Playwright. Imported only when VITE_DEV_MOCK=true (tree-shaken from production). */
import { getTemplate } from "@storychain/shared";
import { DEFAULT_VIEW, type View } from "./layout";
import { loadPhoto } from "./photo";
import { renderCard } from "./renderCard";

export interface RenderRequest {
  /** base64 image bytes */
  image: string;
  templateId: string;
  title: string;
  position?: number;
  fontFamily?: string;
  lang?: "ru" | "en";
  view?: View;
  /** card-space points to sample RGB from the output */
  samples?: Array<[number, number]>;
  /** return the JPEG as a data URL (for visual inspection) */
  dataUrl?: boolean;
}

async function run(req: RenderRequest) {
  const bytes = Uint8Array.from(atob(req.image), (c) => c.charCodeAt(0));
  const photo = await loadPhoto(new Blob([bytes]));
  const template = getTemplate(req.templateId);
  if (!template) throw new Error(`unknown template ${req.templateId}`);
  const position = req.position ?? 7;
  const blob = await renderCard({
    photo,
    view: req.view ?? DEFAULT_VIEW,
    template,
    fontFamily: req.fontFamily ?? null,
    chainTitle: req.title,
    position,
    participants: position,
    lang: req.lang ?? "en",
  });
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  const samples = (req.samples ?? []).map(([x, y]) =>
    Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3)),
  );
  const dataUrl = req.dataUrl
    ? await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(blob);
      })
    : undefined;
  return {
    width: bmp.width,
    height: bmp.height,
    size: blob.size,
    type: blob.type,
    samples,
    photoSize: [photo.width, photo.height],
    dataUrl,
  };
}

(window as unknown as { __storychain: { render: typeof run } }).__storychain = { render: run };
