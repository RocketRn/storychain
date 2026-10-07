import { expect, test } from "@playwright/test";

test("mock mode: switch user, create chain, open by start_param, see gallery", async ({ page }) => {
  // User 1 (default) creates a chain
  await page.goto("/?mock_user=1&mock_lang=en");
  await expect(page.getByRole("heading", { name: "Hi, Anna!" })).toBeVisible();
  await expect(page.getByText("Show your cat").first()).toBeVisible(); // seeded featured chain

  await page.getByRole("link", { name: /Create chain/ }).click();
  await page.getByLabel("Topic").fill("Phase two chain");
  await page.getByLabel("Emoji").fill("🧪");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Phase two chain" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  expect(id).toMatch(/^[A-Za-z0-9_-]{8}$/);
  await expect(page.getByText("Nobody yet. Be the first!")).toBeVisible();

  // Switch to user 2 via the DevTools drawer
  await page.getByRole("button", { name: "DevTools (mock)" }).click();
  await page.getByRole("button", { name: "User 2" }).click();
  await expect(page.getByRole("heading", { name: "Phase two chain" })).toBeVisible();
  await page.getByRole("button", { name: "DevTools (mock)" }).click();
  await expect(page.getByText(/Boris/)).toBeVisible();

  // Open the seeded chain via start_param as user 4: gallery with posts is visible
  await page.goto("/?mock_user=4&mock_start_param=chain_cat00001");
  await expect(page).toHaveURL(/\/chain\/cat00001$/);
  await expect(page.getByRole("heading", { name: "Show your cat" })).toBeVisible();
  const imgs = page.getByRole("list", { name: "gallery" }).getByRole("img");
  await expect(imgs).toHaveCount(3);
  await expect(imgs.first()).toHaveJSProperty("complete", true);
  expect(await imgs.first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: /Join/ })).toBeVisible();
  await page.screenshot({ path: "test-results/phase2-chain.png" });

  // Unknown chain -> friendly empty state with CTA
  await page.goto("/?mock_user=4&mock_start_param=chain_nope1234");
  await expect(page.getByText("Chain not found")).toBeVisible();
  await page.getByRole("link", { name: "Browse chains" }).click();
  await expect(page.getByRole("heading", { name: /Hi,/ })).toBeVisible();
});

test("defaults to Russian and shows Home screenshot", async ({ page }) => {
  await page.goto("/?mock_user=1&mock_lang=ru");
  await expect(page.getByRole("heading", { name: "Привет, Anna!" })).toBeVisible();
  await expect(page.getByText("3 участника").first()).toBeVisible();
  // no quota / plan chips exist any more; the sponsored carousel is pinned at the very top
  await expect(page.locator("body")).not.toContainText(/Free ·|осталось|PRO/);
  await expect(page.getByTestId("boosted-carousel")).toBeVisible();
  await expect(page.getByTestId("boosted-card").first()).toContainText("Реклама");
  await page.screenshot({ path: "test-results/phase2-home.png" });
});
