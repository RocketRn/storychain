import { expect, test } from "@playwright/test";

test("home content does not wait for the session request (no request waterfall)", async ({
  page,
}) => {
  // The session call is slow; the feed must not sit behind it
  await page.route("**/api/auth/session", async (route) => {
    await new Promise((r) => setTimeout(r, 4000));
    await route.continue();
  });
  const t0 = Date.now();
  await page.goto("/?mock_user=1&mock_lang=en");
  await expect(page.getByRole("heading", { name: /Trending|Popular|🔥/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Track of the day/ }).first()).toBeVisible({
    timeout: 3000,
  });
  expect(Date.now() - t0).toBeLessThan(4000); // shown while the session request is still in flight
  // the personalised parts catch up once it arrives
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Anna", { timeout: 8000 });
});

test("an expired Telegram session shows ONE clear message with a way out, not an error per screen", async ({
  page,
}) => {
  // After the initial dev sign-in, the API stops accepting our credentials
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/dev/")) return route.continue();
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "expired" } }),
    });
  });
  await page.goto("/?mock_user=1&mock_lang=en");
  await expect(page.getByText("Session is invalid. Please reopen the app")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  // no half-rendered screens or per-section errors behind it
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Track of the day/ })).toHaveCount(0);
  // navigating inside the app does not bring the old screens back
  await page.goto("/profile?mock_user=1&mock_lang=en");
  await expect(page.getByText("Session is invalid. Please reopen the app")).toBeVisible();
});

test("a 4xx answer is shown at once and is not retried; a 5xx is retried", async ({ page }) => {
  let forbidden = 0;
  await page.route("**/api/chains?sort=trending*", async (route) => {
    forbidden++;
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow" } }),
    });
  });
  let flaky = 0;
  await page.route("**/api/chains/boosted*", async (route) => {
    flaky++;
    if (flaky < 2) return route.fulfill({ status: 503, body: "{}" });
    return route.continue();
  });
  await page.goto("/?mock_user=1&mock_lang=en");
  await expect(page.getByText("Too many requests, try again later")).toBeVisible();
  await page.waitForTimeout(2500); // react-query's first retry delay is 1 s: it must not have fired
  expect(forbidden).toBe(1);
  expect(flaky).toBeGreaterThanOrEqual(2); // the 503 was retried and then succeeded
});
