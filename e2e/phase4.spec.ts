import { expect, test, type Page } from "@playwright/test";
import { splitPhoto } from "./images";

const story = (page: Page) => page.getByRole("dialog", { name: "Story preview (mock)" });

async function publishCard(page: Page, chainId: string, user: number, extra = "") {
  await page.goto(`/chain/${chainId}/join?mock_user=${user}&mock_lang=en${extra}`);
  await page
    .getByTestId("photo-input")
    .setInputFiles({ name: "p.jpg", mimeType: "image/jpeg", buffer: await splitPhoto(1200, 1600) });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Publish to Story" }).click();
}

test("viral loop: create -> post -> fake story -> open link as another user -> join", async ({
  page,
}) => {
  // 1) User 1 creates a chain
  await page.goto("/?mock_user=1&mock_lang=en");
  await page.getByRole("link", { name: /Create chain/ }).click();
  await page.getByLabel("Topic").fill("Viral loop chain");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Viral loop chain" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  const link = `https://t.me/storychain_bot?startapp=chain_${id}`;

  // 2) ...joins it; publishing opens the (mock) story composer with exactly the published image
  await page.getByRole("button", { name: /Join/ }).click();
  await page
    .getByTestId("photo-input")
    .setInputFiles({ name: "p.jpg", mimeType: "image/jpeg", buffer: await splitPhoto(1200, 1600) });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Publish to Story" }).click();

  await expect(story(page)).toBeVisible();
  const caption = await page.getByTestId("story-caption").innerText();
  expect(caption).toContain(link);
  expect(caption.length).toBeLessThanOrEqual(200);
  const args = JSON.parse(await page.getByTestId("story-args").innerText()) as {
    media_url: string;
    params: { text: string; widget_link?: unknown };
  };
  expect(args.media_url).toMatch(/^https?:\/\/.+\/uploads\/posts\/.+\.jpg$/);
  expect(args.params.widget_link).toBeUndefined(); // not Premium: link only in the caption
  await expect(page.getByTestId("story-widget")).toHaveCount(0);
  const img = page.getByTestId("story-image");
  await expect(img).toHaveAttribute("src", args.media_url);
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1080);

  // "Download PNG" works
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    story(page)
      .getByRole("button", { name: /Download PNG/ })
      .click(),
  ]);
  expect(download.suggestedFilename()).toBe("storychain-card.png");

  // 3) Open the story link as another mock user -> lands on the chain (start_param routing)
  await story(page).getByRole("link", { name: "User 2" }).click();
  await expect(page).toHaveURL(new RegExp(`/chain/${id}$`));
  await expect(page.getByRole("heading", { name: "Viral loop chain" })).toBeVisible();
  await expect(page.getByText("1 participant").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "gallery" }).getByRole("img")).toHaveCount(1);

  // 4) User 2 joins and re-shares
  await page.getByRole("button", { name: /Join/ }).click();
  await page
    .getByTestId("photo-input")
    .setInputFiles({ name: "p.jpg", mimeType: "image/jpeg", buffer: await splitPhoto(1600, 1200) });
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Publish to Story" }).click();
  await expect(story(page)).toBeVisible();
  await story(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByText("You are #2")).toBeVisible();
  await page.getByRole("button", { name: "Open chain" }).click();
  await expect(page.getByText("2 participants").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "gallery" }).getByRole("img")).toHaveCount(2);

  // 5) Joined users get "share again" + "send to chat" instead of "Join"
  await expect(page.getByRole("button", { name: /Join$/ })).toHaveCount(0);
  await page.getByRole("button", { name: /share again/ }).click();
  await expect(story(page)).toBeVisible();
  await story(page).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /Send to chat/ }).click();
  const tgLink = new URL((await page.getByTestId("tg-link").innerText()).trim());
  expect(tgLink.origin + tgLink.pathname).toBe("https://t.me/share/url");
  expect(tgLink.searchParams.get("url")).toBe(link);
  await page
    .getByRole("dialog", { name: "openTelegramLink (mock)" })
    .getByRole("button", { name: "Close" })
    .click();
  await page.screenshot({ path: "test-results/phase4-joined.png" });
});

test("Premium authors also pass widget_link (link stays in the caption)", async ({ page }) => {
  await publishCard(page, "cat00001", 6, "&mock_premium=1");
  await expect(story(page)).toBeVisible();
  await expect(page.getByTestId("story-widget")).toContainText("Join the chain");
  const args = JSON.parse(await page.getByTestId("story-args").innerText()) as {
    params: { text: string; widget_link: { url: string; name: string } };
  };
  expect(args.params.widget_link.url).toBe("https://t.me/storychain_bot?startapp=chain_cat00001");
  expect(args.params.widget_link.name.length).toBeLessThanOrEqual(48);
  expect(args.params.text).toContain("startapp=chain_cat00001");
  await page.screenshot({ path: "test-results/phase4-story.png" });
});

test("legacy client (< 7.8): manual fallback instead of shareToStory", async ({ page }) => {
  await publishCard(page, "desk0002", 7, "&mock_legacy=1");
  const dialog = page.getByRole("dialog", { name: "Alert (mock)" });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("mock-dialog-message")).toContainText("can't publish stories");
  await expect(story(page)).toHaveCount(0);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(page.getByTestId("editor-done")).toBeVisible();
});

test.describe("start_param routing", () => {
  test("tgWebAppStartParam in the query (bot web_app button)", async ({ page }) => {
    await page.goto("/?mock_user=2&tgWebAppStartParam=chain_cat00001");
    await expect(page).toHaveURL(/\/chain\/cat00001$/);
    await expect(page.getByRole("heading", { name: "Show your cat" })).toBeVisible();
  });

  test("tgWebAppStartParam in the hash (how Telegram passes launch params)", async ({ page }) => {
    await page.goto("/?mock_user=2#tgWebAppStartParam=chain_desk0002");
    await expect(page).toHaveURL(/\/chain\/desk0002/);
    await expect(page.getByRole("heading", { name: "Your desk right now" })).toBeVisible();
  });

  test("invalid or non-chain start params are ignored", async ({ page }) => {
    await page.goto("/?mock_user=2&mock_lang=en&mock_start_param=something_else");
    await expect(page.getByRole("heading", { name: /Hi,/ })).toBeVisible();
    await expect(page).toHaveURL(/\/\?/);
  });
});
