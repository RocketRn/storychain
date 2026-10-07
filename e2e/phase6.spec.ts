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

test("full journey: a free user publishes without limits, creates a marathon, boosts it, sees it in the carousel and on the profile", async ({
  page,
}) => {
  await page.goto("/?mock_user=30&mock_lang=en");
  await expect(page.getByRole("heading", { name: /Hi,/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Free ·|PRO/);

  // 4 publications in a row (the old limit was 3): no limit screen, no paywall
  for (const chain of ["cat00001", "desk0002", "trk00003", "hot00002"]) {
    await publishOn(page, chain);
    await story(page).getByRole("button", { name: "Close" }).click();
  }
  await publishOn(page, "hot00001");
  await story(page).getByRole("button", { name: "Close" }).click();

  // create a marathon and boost it with Stars
  await page.goto("/create?mock_user=30&mock_lang=en");
  await page.getByLabel("Topic").fill("Journey marathon");
  await page.getByTestId("create-channel-input").fill("@journeychan");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByTestId("boost-button").click();
  await page.getByTestId("pay-stars").click();
  await page
    .getByRole("dialog", { name: "Stars payment (mock)" })
    .getByRole("button", { name: "Pay" })
    .click();
  await expect(page.getByTestId("boost-success")).toBeVisible();
  await page.getByTestId("boost-success").getByRole("button", { name: "Done" }).click();

  await page.goto("/");
  await expect(
    page.getByTestId("boosted-card").filter({ hasText: "Journey marathon" }),
  ).toBeVisible();

  // profile: my marathons (boosted) and my posts (5 chains)
  await page.goto("/profile");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("User");
  const row = page.getByTestId("my-marathon").filter({ hasText: "Journey marathon" });
  await expect(row).toContainText("Boosted");
  await expect(page.getByRole("list", { name: "My posts" }).getByRole("link")).toHaveCount(5);
  await page.getByRole("list", { name: "My posts" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/chain\//);
});

test("profile: empty state for a user without posts", async ({ page }) => {
  await page.goto("/profile?mock_user=31&mock_lang=en");
  await expect(page.getByText("You haven't joined any chain yet")).toBeVisible();
  await expect(page.getByText("You haven't created any marathon yet")).toBeVisible();
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
    await page.goto("/chain/hot00001?mock_user=1&mock_lang=en"); // Anna created the demo chains
    await page.getByTestId("boost-button").click();
    await expect(page.getByTestId("pay-stars")).toBeVisible();
    await noHorizontalScroll(page, "boost modal");
    const sheet = (await page.getByTestId("boost-modal").boundingBox()) as {
      width: number;
      height: number;
    };
    expect(sheet.height).toBeLessThanOrEqual(844 * 0.92 + 1); // the sheet always fits the viewport
    await page.screenshot({ path: "test-results/mobile-boost.png" });
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
      await expect(page.getByTestId("boosted-carousel")).toBeVisible();
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

      await page.goto("/chain/hot00001?mock_user=1&mock_lang=en"); // Anna created the demo chains
      await page.getByTestId("boost-button").click();
      await expect(page.getByTestId("pay-stars")).toBeVisible();
      await hideMock(page);
      await audit(page, `boost modal ${scheme}`);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("boost-modal")).toHaveCount(0);

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
