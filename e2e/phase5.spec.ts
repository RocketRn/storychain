import { expect, test, type Page } from "@playwright/test";
import { splitPhoto } from "./images";

const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });

test.describe("Stars (mock invoice -> real server-side grant)", () => {
  test("pay -> server marks paid -> PRO unlocked everywhere", async ({ page }) => {
    await page.goto("/pro?mock_user=8&mock_lang=en");
    await expect(page.getByRole("heading", { name: "StoryChain PRO" })).toBeVisible();
    await expect(page.getByTestId("pro-status")).toHaveCount(0);
    await page.getByTestId("pay-stars").click();
    await expect(dialog(page, "Stars payment (mock)")).toBeVisible();
    await dialog(page, "Stars payment (mock)").getByRole("button", { name: "Pay" }).click();
    await expect(page.getByTestId("pay-success")).toBeVisible();
    await page.screenshot({ path: "test-results/phase5-paid.png" });

    // PRO state propagated: paywall status, Home chip
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page.getByText(/PRO until/)).toBeVisible();

    // PRO in the editor: no watermark overlay, premium template + font are usable
    await page.goto("/chain/cat00001/join?mock_user=8&mock_lang=en");
    await page.getByTestId("photo-input").setInputFiles({
      name: "p.jpg",
      mimeType: "image/jpeg",
      buffer: await splitPhoto(1200, 1600),
    });
    await expect(page.getByTestId("card-preview")).toBeVisible();
    await expect(page.getByTestId("watermark-overlay")).toHaveCount(0);
    await page.getByTestId("template-neon").click();
    await expect(page.getByTestId("template-neon")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("font-Pacifico").click();
    await expect(page).toHaveURL(/\/join(\?|$)/); // not bounced to the paywall

    // paying again while PRO extends (paywall shows the active status)
    await page.goto("/pro?mock_user=8&mock_lang=en");
    await expect(page.getByTestId("pro-status")).toContainText("PRO active until");
  });

  test("cancelled and failed payments grant nothing", async ({ page }) => {
    await page.goto("/pro?mock_user=9&mock_lang=en");
    await page.getByTestId("pay-stars").click();
    await dialog(page, "Stars payment (mock)").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Payment cancelled")).toBeVisible();
    await page.getByTestId("pay-stars").click();
    await dialog(page, "Stars payment (mock)").getByRole("button", { name: "Fail" }).click();
    await expect(page.getByRole("alert")).toHaveText("Payment failed. Please try again.");
    await expect(page.getByTestId("pay-success")).toHaveCount(0);
    await page.goto("/?mock_user=9&mock_lang=en");
    await expect(page.getByText(/Free ·/)).toBeVisible();
  });
});

test.describe("GRM (mock simulation panel)", () => {
  test("intent -> simulate -> polling -> PRO", async ({ page }) => {
    await page.goto("/pro?mock_user=10&mock_lang=en");
    await expect(page.getByTestId("mock-grm")).toBeVisible();
    await page.getByTestId("grm-create").click();
    const intent = page.getByTestId("grm-intent");
    await expect(intent).toContainText("100 GRM (100000000000 units)");
    await expect(intent).toContainText("EQC47093oX5Xhb0xuk2lCr2RhS8rj-vul61u4W2UH5ORmG_O");
    const ref = (await intent.locator("dd").first().innerText()).trim();
    expect(ref).toMatch(/^[A-Za-z0-9]{16}$/);
    await page.getByTestId("grm-simulate").click();
    await expect(page.getByTestId("pay-success")).toBeVisible();
    await page.goto("/?mock_user=10&mock_lang=en");
    await expect(page.getByText(/PRO until/)).toBeVisible();
  });

  test("on iOS/Android only Stars is offered (platform policy)", async ({ page }) => {
    await page.goto("/pro?mock_user=11&mock_lang=en&mock_platform=ios");
    await expect(page.getByTestId("pay-stars")).toBeVisible();
    await expect(page.getByTestId("mock-grm")).toHaveCount(0);
    await expect(page.getByText("GRM payments are not available on this platform")).toBeVisible();
  });

  test("Russian paywall", async ({ page }) => {
    await page.goto("/pro?mock_user=12&mock_lang=ru");
    await expect(page.getByText("Без водяного знака")).toBeVisible();
    await expect(page.getByTestId("pay-stars")).toContainText("Оплатить Stars · 150");
  });
});

test.describe("real (non-mock) build path", () => {
  test.use({ baseURL: "http://localhost:5274" });

  test("real Telegram facade + lazy TonConnect chunk render without runtime errors; Stars goes through openInvoice", async ({
    page,
    request,
  }) => {
    const init = await request.post("http://localhost:3100/api/dev/init-data", {
      data: { userId: 1000020, languageCode: "en" },
    });
    const { initData } = (await init.json()) as { initData: string };
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://telegram.org/**", (r) => r.abort()); // keep the fake WebApp below

    await page.addInitScript((data) => {
      const noop = () => undefined;
      const btn = {
        setText: noop,
        show: noop,
        hide: noop,
        enable: noop,
        disable: noop,
        showProgress: noop,
        hideProgress: noop,
        onClick: noop,
        offClick: noop,
      };
      const w = window as unknown as Record<string, unknown>;
      w.Telegram = {
        WebApp: {
          initData: data,
          initDataUnsafe: { user: { id: 1000020, first_name: "Real", language_code: "en" } },
          platform: "tdesktop",
          colorScheme: "light",
          themeParams: {},
          version: "9.0",
          isVersionAtLeast: () => true,
          ready: noop,
          expand: noop,
          BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
          MainButton: btn,
          HapticFeedback: { impact: noop, notification: noop, selection: noop },
          openInvoice: (url: string, cb: (s: string) => void) => {
            w.__invoiceUrl = url;
            w.__invoiceCb = cb;
          },
          showAlert: (_m: string, cb?: () => void) => cb?.(),
          showConfirm: (_m: string, cb?: (ok: boolean) => void) => cb?.(true),
        },
      };
    }, initData);

    await page.goto("/pro");
    await expect(page.getByRole("heading", { name: "StoryChain PRO" })).toBeVisible();
    // GRM: the TonConnect chunk is only fetched once the user picks GRM
    expect(
      await page.evaluate(() =>
        performance.getEntriesByType("resource").some((r) => /TonPay|tonconnect/i.test(r.name)),
      ),
    ).toBe(false);
    await page.getByTestId("open-grm").click();
    // real TonConnect widget, loaded from its own chunk (needs the Buffer polyfill)
    await expect(page.getByTestId("ton-connect")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#tc-widget-root")).toBeAttached({ timeout: 15_000 });
    await expect(page.getByTestId("mock-grm")).toHaveCount(0);

    // Stars: the real facade calls Telegram.WebApp.openInvoice with the server-created invoice link
    await page.getByTestId("pay-stars").click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __invoiceUrl?: string }).__invoiceUrl),
      )
      .toMatch(/^mock-invoice:\/\//);
    const url = await page.evaluate(
      () => (window as unknown as { __invoiceUrl: string }).__invoiceUrl,
    );
    // Telegram would call the bot; simulate that server-side, then report "paid" from the (untrusted) client side
    const done = await request.post(
      `http://localhost:3100/api/dev/payments/${url.replace("mock-invoice://", "")}/complete`,
    );
    expect(await done.json()).toEqual({ outcome: "paid" });
    await page.evaluate(() =>
      (window as unknown as { __invoiceCb: (s: string) => void }).__invoiceCb("paid"),
    );
    await expect(page.getByTestId("pay-success")).toBeVisible();
    expect(errors).toEqual([]);
  });
});
