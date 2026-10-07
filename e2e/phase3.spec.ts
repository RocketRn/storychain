import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { noisyPhoto, splitPhoto } from "./images";

interface RenderResult {
  width: number;
  height: number;
  size: number;
  type: string;
  samples: number[][];
  photoSize: number[];
  dataUrl?: string;
}

async function render(
  page: Page,
  image: Buffer,
  req: Record<string, unknown>,
): Promise<RenderResult> {
  return page.evaluate(
    (r) =>
      (
        window as unknown as { __storychain: { render: (x: unknown) => Promise<RenderResult> } }
      ).__storychain.render(r),
    { image: image.toString("base64"), ...req },
  );
}

async function openEditorPage(page: Page, user = 4) {
  await page.goto(`/chain/cat00001/join?mock_user=${user}&mock_lang=en`);
  await page.waitForFunction(() => "__storychain" in window);
}

test.describe("renderCard", () => {
  test("produces exactly 1080x1920 JPEG under 3 MB for every template", async ({ page }) => {
    await openEditorPage(page);
    const photo = await noisyPhoto(3000, 2000); // large + noisy: worst case for size
    for (const templateId of [
      "sunset",
      "ocean",
      "minimal-light",
      "polaroid",
      "neon",
      "film-strip",
      "aurora",
      "retro-pop",
    ]) {
      const r = await render(page, photo, { templateId, title: "Show your cat" });
      expect([templateId, r.width, r.height, r.type]).toEqual([
        templateId,
        1080,
        1920,
        "image/jpeg",
      ]);
      expect(r.size, templateId).toBeLessThan(3 * 1024 * 1024);
    }
  });

  test("honors EXIF orientation (rotated phone photo ends up upright)", async ({ page }) => {
    await openEditorPage(page);
    // Stored 600x300 landscape (left red / right blue) with EXIF orientation 6 (rotate 90° CW):
    // displayed as 300x600 portrait with RED on TOP and BLUE on the BOTTOM.
    const photo = await splitPhoto(600, 300, { orientation: 6 });
    const f = { x: 90, y: 310, w: 900, h: 960 }; // "sunset" frame
    const r = await render(page, photo, {
      templateId: "sunset",
      title: "EXIF",
      samples: [
        [f.x + f.w / 2, f.y + 120],
        [f.x + f.w / 2, f.y + f.h - 120],
      ],
    });
    expect(r.photoSize).toEqual([300, 600]); // dimensions already swapped by createImageBitmap
    const [top, bottom] = r.samples as [number[], number[]];
    expect(top[0]).toBeGreaterThan(180); // red channel high on top
    expect(top[2]).toBeLessThan(80);
    expect(bottom[2]).toBeGreaterThan(180); // blue on the bottom
    expect(bottom[0]).toBeLessThan(80);
  });

  test("handles tall and wide photos (cover fit fills the frame, no letterboxing)", async ({
    page,
  }) => {
    await openEditorPage(page);
    const f = { x: 90, y: 310, w: 900, h: 960 };
    for (const [w, h] of [
      [400, 3000],
      [3000, 400],
    ] as const) {
      const photo = await splitPhoto(w, h);
      const r = await render(page, photo, {
        templateId: "minimal-light",
        title: "Tall or wide",
        samples: [
          [f.x + 10, f.y + 10],
          [f.x + f.w - 10, f.y + 10],
          [f.x + 10, f.y + f.h - 10],
          [f.x + f.w - 10, f.y + f.h - 10],
        ],
      });
      // every frame corner is photo (red or blue), never the cream background (#f4f1ea)
      for (const s of r.samples) {
        const isPhoto = (s[0] as number) > 150 !== (s[2] as number) > 150;
        expect(isPhoto, `${w}x${h} ${s}`).toBe(true);
      }
    }
  });

  test("fonts load for Cyrillic and long titles do not break rendering; saves a contact sheet", async ({
    page,
  }) => {
    await openEditorPage(page);
    mkdirSync("test-results", { recursive: true });
    const photo = await splitPhoto(1600, 1200);
    const cases: Array<[string, string, string]> = [
      ["sunset", "Покажи своего кота прямо сейчас и расскажи о нём", "ru"],
      ["polaroid", "Your desk right now with your morning coffee and plants", "en"],
      [
        "neon",
        "Очень длинное название цепочки которое никак не помещается в две строки даже на минимальном размере шрифта",
        "ru",
      ],
      ["film-strip", "A".repeat(70), "en"],
      ["aurora", "Track of the day", "en"],
      ["retro-pop", "Трек дня 🎧", "ru"],
    ];
    for (const [templateId, title, lang] of cases) {
      const r = await render(page, photo, {
        templateId,
        title,
        lang,
        position: 128,
        dataUrl: true,
      });
      expect([r.width, r.height]).toEqual([1080, 1920]);
      writeFileSync(
        `test-results/card-${templateId}.jpg`,
        Buffer.from((r.dataUrl as string).split(",")[1] as string, "base64"),
      );
    }
  });
});

test.describe("editor flow", () => {
  test("photo -> style -> publish; every template is open; the server adds the badge", async ({
    page,
  }) => {
    await page.goto("/chain/cat00001?mock_user=4&mock_lang=en");
    await expect(page.getByRole("heading", { name: "Show your cat" })).toBeVisible();
    await page.getByRole("button", { name: /Join/ }).click();
    await expect(page).toHaveURL(/\/chain\/cat00001\/join$/);

    await page.getByTestId("photo-input").setInputFiles({
      name: "p.jpg",
      mimeType: "image/jpeg",
      buffer: await splitPhoto(1200, 1600),
    });
    await expect(page.getByTestId("card-preview")).toBeVisible();
    await expect(page.getByTestId("badge-overlay")).toBeVisible(); // the live badge preview is shown to everyone

    // template picker: nothing is locked or badged
    await page.getByTestId("template-minimal-light").click();
    await expect(page.getByTestId("template-minimal-light")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByTestId("template-neon")).not.toContainText(/PRO|🔒/);
    await page.screenshot({ path: "test-results/editor-style.png" });

    // pan + zoom change the preview (drag on canvas, wheel)
    const canvas = page.getByTestId("card-preview");
    await canvas.scrollIntoViewIfNeeded(); // clicking a template may have scrolled the canvas off-screen
    const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const box = (await canvas.boundingBox()) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 3 + 40, { steps: 5 });
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL()))
      .not.toBe(before);

    // Next (mock MainButton) -> preview -> Publish
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByLabel("Caption (optional)").fill("my cat");
    await page.getByRole("button", { name: "Publish to Story" }).click();
    await expect(page.getByTestId("editor-done")).toBeVisible();
    await expect(page.getByText("You are #4")).toBeVisible();
    // publishing opens the (mock) story composer: close it
    await page
      .getByRole("dialog", { name: "Story preview (mock)" })
      .getByRole("button", { name: "Close" })
      .click();

    // The stored image is 1080x1920 and carries the server-side badge in the bottom-right
    const src = (await page
      .getByTestId("editor-done")
      .locator("img")
      .getAttribute("src")) as string;
    const px = await page.evaluate(async (u) => {
      const b = await createImageBitmap(await (await fetch(u)).blob());
      const c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const ctx = c.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(b, 0, 0);
      const red = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[0] as number;
      // minimal-light has a flat cream background: the dark watermark pill stands out on the row below the sticker
      return { w: b.width, h: b.height, inPill: red(815, 1663), outside: red(300, 1663) };
    }, src);
    expect([px.w, px.h]).toEqual([1080, 1920]);
    expect(px.outside - px.inPill).toBeGreaterThan(60);

    await page.getByRole("button", { name: "Open chain" }).click();
    await expect(page.getByText("4 participants").first()).toBeVisible();
  });

  test("every template and every font is selectable at once, with no lock, modal or redirect", async ({
    page,
  }) => {
    await page.goto("/chain/desk0002/join?mock_user=3&mock_lang=en");
    await page.getByTestId("photo-input").setInputFiles({
      name: "p.jpg",
      mimeType: "image/jpeg",
      buffer: await splitPhoto(1200, 1600),
    });
    for (const id of ["neon", "film-strip", "aurora", "retro-pop", "polaroid", "ocean"]) {
      await page.getByTestId(`template-${id}`).click();
      await expect(page.getByTestId(`template-${id}`)).toHaveAttribute("aria-pressed", "true");
    }
    for (const f of ["Unbounded", "Oswald", "Playfair Display", "Pacifico", "Manrope", "Inter"]) {
      await page.getByTestId(`font-${f}`).click();
      await expect(page.getByTestId(`font-${f}`)).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page).toHaveURL(/\/join(\?|$)/); // never bounced anywhere
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/PRO|🔒|paywall|upgrade/i);
    await page.getByTestId("template-neon").click();
    await page.getByTestId("font-Pacifico").click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Publish to Story" }).click();
    await expect(page.getByTestId("editor-done")).toBeVisible();
  });

  test("non-image file shows an error", async ({ page }) => {
    await page.goto("/chain/trk00003/join?mock_user=2&mock_lang=en");
    await page
      .getByTestId("photo-input")
      .setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("nope") });
    await expect(page.getByRole("alert")).toHaveText("Could not open this image");
  });
});
