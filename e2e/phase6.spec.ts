import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { splitPhoto } from "./images";

const story = (page: Page) => page.getByRole("dialog", { name: "Story preview (mock)" });

async function publishOn(page: Page, chainId: string, template = "minimal-light") {
  await page.goto(`/chain/${chainId}/join`);
  await page
    .getByTestId("photo-input")
    .setInputFiles({ name: "p.jpg", mimeType: "image/jpeg", buffer: await splitPhoto(1200, 1600) });
  await page.getByTestId(`template-${template}`).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Publish to Story" }).click();
  await expect(page.getByTestId("editor-done")).toBeVisible();
}

/** Mean red channel of the stored image at the watermark pill vs. the same row elsewhere (flat cream template). */
async function watermarkContrast(page: Page, src: string): Promise<number> {
  return page.evaluate(async (u) => {
    const bmp = await createImageBitmap(await (await fetch(u)).blob());
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d") as CanvasRenderingContext2D;
    ctx.drawImage(bmp, 0, 0);
    const red = (x: number, y: number) => ctx.getImageData(x, y, 1, 1).data[0] as number;
    return red(300, 1663) - red(815, 1663);
  }, src);
}

test("full journey: free limit -> paywall -> GRM -> unlimited, no watermark -> profile", async ({
  page,
}) => {
  // brand-new user #30
  await page.goto("/?mock_user=30&mock_lang=en");
  await expect(page.getByText("Free · 3 left")).toBeVisible();

  // 1st publication is watermarked (server side)
  await publishOn(page, "cat00001");
  await story(page).getByRole("button", { name: "Close" }).click();
  const first = (await page
    .getByTestId("editor-done")
    .locator("img")
    .getAttribute("src")) as string;
  expect(await watermarkContrast(page, first)).toBeGreaterThan(60);

  // publications 2 and 3
  for (const chain of ["desk0002", "trk00003"]) {
    await publishOn(page, chain);
    await story(page).getByRole("button", { name: "Close" }).click();
  }

  // 4th: the editor shows the limit screen with a PRO call to action
  await page.goto("/chain/cat00001/join");
  await expect(page.getByText("Daily limit reached")).toBeVisible();
  await page.getByRole("link", { name: /Get PRO/ }).click();
  await expect(page.getByRole("heading", { name: "StoryChain PRO" })).toBeVisible();

  // pay with GRM (mock): intent -> simulate -> server-side polling -> PRO
  await page.getByTestId("grm-create").click();
  await page.getByTestId("grm-simulate").click();
  await expect(page.getByTestId("pay-success")).toBeVisible();

  // PRO: the same editor now works, with no watermark and no limit
  await publishOn(page, "cat00001");
  await story(page).getByRole("button", { name: "Close" }).click();
  const pro = (await page.getByTestId("editor-done").locator("img").getAttribute("src")) as string;
  expect(Math.abs(await watermarkContrast(page, pro))).toBeLessThan(20);

  // profile shows PRO and my posts (re-posting to cat00001 replaced the first card: 3 distinct chains)
  await page.getByRole("button", { name: "Open chain" }).click();
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("User");
  await expect(page.getByText("PRO", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "My posts" }).getByRole("link")).toHaveCount(3);
  await page.getByRole("list", { name: "My posts" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/chain\//);
});

test("profile: empty state for a user without posts", async ({ page }) => {
  await page.goto("/profile?mock_user=31&mock_lang=en");
  await expect(page.getByText("You haven't joined any chain yet")).toBeVisible();
  await expect(page.getByText(/Published today: 0 of 3/)).toBeVisible();
});

test.describe("mobile layout (390x844, touch)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const noHorizontalScroll = async (page: Page, label: string) => {
    const [sw, iw] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(sw, `${label}: horizontal overflow`).toBeLessThanOrEqual(iw);
  };

  test("no horizontal overflow on any screen; editor preview fits the viewport", async ({
    page,
  }) => {
    await page.goto("/?mock_user=32&mock_lang=en");
    await expect(page.getByRole("heading", { name: /Hi,/ })).toBeVisible();
    await noHorizontalScroll(page, "home");
    await page.screenshot({ path: "test-results/mobile-home.png" });

    await page.goto("/chain/cat00001");
    await expect(page.getByRole("list", { name: "gallery" })).toBeVisible();
    await noHorizontalScroll(page, "chain");

    await page.goto("/create");
    await noHorizontalScroll(page, "create");
    await page.goto("/pro");
    await expect(page.getByTestId("pay-stars")).toBeVisible();
    await noHorizontalScroll(page, "paywall");
    await page.goto("/profile");
    await noHorizontalScroll(page, "profile");

    await page.goto("/chain/desk0002/join");
    await page.getByTestId("photo-input").setInputFiles({
      name: "p.jpg",
      mimeType: "image/jpeg",
      buffer: await splitPhoto(1200, 1600),
    });
    const canvas = page.getByTestId("card-preview");
    await expect(canvas).toBeVisible();
    await noHorizontalScroll(page, "editor");
    const box = (await canvas.boundingBox()) as { width: number; height: number };
    expect(box.height).toBeLessThanOrEqual(844 * 0.6); // preview leaves room for the pickers
    expect(Math.abs(box.width / box.height - 9 / 16)).toBeLessThan(0.01);
    await page.screenshot({ path: "test-results/mobile-editor.png" });
  });

  test("touch pinch-zoom support: pointer handlers keep the page from scrolling under the preview", async ({
    page,
  }) => {
    await page.goto("/chain/desk0002/join?mock_user=33");
    await page.getByTestId("photo-input").setInputFiles({
      name: "p.jpg",
      mimeType: "image/jpeg",
      buffer: await splitPhoto(1200, 1600),
    });
    await expect(page.getByTestId("card-preview")).toHaveCSS("touch-action", "none");
  });
});

test.describe("accessibility (axe, WCAG 2 A/AA)", () => {
  const audit = async (page: Page, label: string) => {
    const r = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .exclude("[aria-label='DevTools']")
      .analyze();
    const summary = r.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    );
    expect(summary, label).toEqual([]);
  };
  // the mock's own DOM chrome (Back / Dev buttons) is test scaffolding, not product UI
  const hideMock = (page: Page) =>
    page.addStyleTag({
      content:
        "button[aria-label^='Telegram BackButton'], button[aria-label^='DevTools'] { display:none !important }",
    });

  for (const scheme of ["light", "dark"] as const) {
    test(`screens have no a11y violations (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/?mock_user=34&mock_lang=en");
      await expect(page.getByRole("heading", { name: /Hi,/ })).toBeVisible();
      await expect(page.getByText("Show your cat").first()).toBeVisible();
      await hideMock(page);
      await audit(page, `home ${scheme}`);

      await page.goto("/chain/cat00001");
      await expect(
        page.getByRole("list", { name: "gallery" }).getByRole("img").first(),
      ).toBeVisible();
      await hideMock(page);
      await audit(page, `chain ${scheme}`);

      await page.goto("/create");
      await hideMock(page);
      await audit(page, `create ${scheme}`);

      await page.goto("/pro");
      await expect(page.getByTestId("pay-stars")).toBeVisible();
      await hideMock(page);
      await audit(page, `paywall ${scheme}`);

      await page.goto("/profile");
      await hideMock(page);
      await audit(page, `profile ${scheme}`);

      await page.goto("/chain/desk0002/join");
      await page.getByTestId("photo-input").setInputFiles({
        name: "p.jpg",
        mimeType: "image/jpeg",
        buffer: await splitPhoto(1200, 1600),
      });
      await expect(page.getByTestId("card-preview")).toBeVisible();
      await hideMock(page);
      await audit(page, `editor ${scheme}`);
    });
  }
});
