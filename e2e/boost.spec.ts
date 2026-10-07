import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { splitPhoto } from "./images";

const modal = (page: Page) => page.getByTestId("boost-modal");
const carousel = (page: Page) => page.getByTestId("boosted-carousel");
const card = (page: Page, title: string) =>
  page.getByTestId("boosted-card").filter({ hasText: title });

/** A fresh chain created straight through the API (keeps the seeded demo chains untouched for other specs). */
async function apiChain(request: APIRequestContext, user: number, title: string): Promise<string> {
  const init = await request.post("http://localhost:3100/api/dev/init-data", {
    data: { userId: 1_000_000 + user },
  });
  const { initData } = (await init.json()) as { initData: string };
  const res = await request.post("http://localhost:3100/api/chains", {
    headers: { authorization: `tma ${initData}` },
    data: { title },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Create a chain through the UI as the current mock user and land on its page. */
async function createChain(page: Page, user: number, title: string, channel?: string) {
  await page.goto(`/create?mock_user=${user}&mock_lang=en`);
  await page.getByLabel("Topic").fill(title);
  if (channel) await page.getByTestId("create-channel-input").fill(channel);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop() as string;
}

async function publish(page: Page, chainId: string, user: number, template?: string) {
  await page.goto(`/chain/${chainId}/join?mock_user=${user}&mock_lang=en`);
  await page.getByTestId("photo-input").setInputFiles({
    name: "p.jpg",
    mimeType: "image/jpeg",
    buffer: await splitPhoto(1200, 1600),
  });
  if (template) await page.getByTestId(`template-${template}`).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Publish to Story" }).click();
  await expect(page.getByTestId("editor-done")).toBeVisible();
  // publishing opens the (mock) story composer
  await page
    .getByRole("dialog", { name: "Story preview (mock)" })
    .getByRole("button", { name: "Close" })
    .click();
}

test("1. viral loop with no limits: five publications in a row, no paywall ever, cards stay 1080x1920", async ({
  page,
  request,
}) => {
  const chains: string[] = [];
  for (let i = 0; i < 6; i++) chains.push(await apiChain(request, 39, `Unlimited loop ${i}`));
  for (const [i, id] of chains.slice(0, 5).entries()) {
    await publish(page, id, 40, i % 2 ? "neon" : "aurora"); // "premium-looking" templates are simply free
    await expect(page.locator("body")).not.toContainText(/paywall|upgrade|daily limit|PRO\b|🔒/i);
    await expect(page.locator('a[href="/pro"]')).toHaveCount(0);
  }
  // a different user publishes too, and the first user keeps going with a 6th card
  await publish(page, chains[0] as string, 41);
  await publish(page, chains[5] as string, 40);

  // the exported card is exactly 1080x1920 (and the server would reject anything else)
  await page.goto(`/chain/${chains[0]}/join?mock_user=40&mock_lang=en`);
  await page.waitForFunction(() => "__storychain" in window);
  const photo = (await splitPhoto(2000, 1500)).toString("base64");
  const r = await page.evaluate(
    (image) =>
      (
        window as unknown as {
          __storychain: {
            render: (
              x: unknown,
            ) => Promise<{ width: number; height: number; type: string; size: number }>;
          };
        }
      ).__storychain.render({ image, templateId: "neon", title: "Unlimited loop" }),
    photo,
  );
  expect([r.width, r.height, r.type]).toEqual([1080, 1920, "image/jpeg"]);
  expect(r.size).toBeLessThan(3 * 1024 * 1024);
});

test("seeded demo: the Hot carousel shows active boosts, a channel link, and hides expired ones", async ({
  page,
}) => {
  await page.goto("/?mock_user=1&mock_lang=en");
  await expect(carousel(page)).toBeVisible();
  await expect(card(page, "Channel marathon: best shot of the week")).toBeVisible();
  await expect(card(page, "Morning coffee ritual")).toBeVisible();
  await expect(card(page, "Last week's challenge")).toHaveCount(0); // boost ended
  // sponsored label on every card; the channel button only where a channel link exists
  for (const c of await page.getByTestId("boosted-card").all())
    await expect(c).toContainText("Sponsored");
  await expect(card(page, "Channel marathon").getByTestId("channel-button")).toBeVisible();
  await expect(card(page, "Morning coffee ritual").getByTestId("channel-button")).toHaveCount(0);
  // the carousel is the very first thing on the page
  const top = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="boosted-carousel"]') as HTMLElement;
    const h1 = document.querySelector("h1") as HTMLElement;
    return el.getBoundingClientRect().top < h1.getBoundingClientRect().top;
  });
  expect(top).toBe(true);

  // the channel button opens the t.me link through Telegram (mock: a visible modal)
  await card(page, "Channel marathon").getByTestId("channel-button").click();
  await expect(page.getByTestId("tg-link")).toHaveText("https://t.me/storychain_demo");
  await page
    .getByRole("dialog", { name: "openTelegramLink (mock)" })
    .getByRole("button", { name: "Close" })
    .click();

  // tapping the card body opens the chain, which also shows the Sponsored badge + channel button to a stranger
  await card(page, "Channel marathon").getByRole("link").click();
  await expect(page).toHaveURL(/\/chain\/hot00001$/);
  await expect(page.getByText("Sponsored").first()).toBeVisible();
  await expect(page.getByTestId("channel-button")).toBeVisible();
  await expect(page.getByTestId("boost-button")).toHaveCount(1); // user 1 (Anna) created the demo chains
  await page.screenshot({ path: "test-results/boost-chain.png" });
});

test("2. boost via Stars (24h): the chain lands in the Hot carousel with its channel link", async ({
  page,
}) => {
  const title = "Stars boosted marathon";
  await createChain(page, 42, title, "@starschannel");
  // not boosted yet: not in the carousel, no Sponsored badge
  await page.goto("/?mock_user=42&mock_lang=en");
  await expect(card(page, title)).toHaveCount(0);

  await page.goto(`/?mock_user=42&mock_lang=en`);
  await page
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click();
  await page.getByTestId("boost-button").click();
  await expect(modal(page)).toBeVisible();
  await expect(page.getByTestId("channel-input")).toHaveValue("https://t.me/starschannel"); // prefilled
  await expect(page.getByTestId("pay-stars")).toContainText("100 ⭐");
  await page.getByTestId("pay-stars").click();
  await page
    .getByRole("dialog", { name: "Stars payment (mock)" })
    .getByRole("button", { name: "Pay" })
    .click();
  await expect(page.getByTestId("boost-success")).toContainText(
    "Your marathon is now in the Hot carousel until",
  );
  await page.screenshot({ path: "test-results/boost-success.png" });
  await page.getByTestId("boost-success").getByRole("button", { name: "Done" }).click();

  // the chain page flips to "Boosted until … · Extend" and the Sponsored badge
  await expect(page.getByTestId("boost-button")).toContainText("Boosted until");
  await expect(page.getByTestId("boost-button")).toContainText("Extend");

  await page.goto("/?mock_user=42&mock_lang=en");
  await expect(carousel(page)).toBeVisible();
  const c = card(page, title);
  await expect(c).toBeVisible();
  await c.getByTestId("channel-button").click();
  await expect(page.getByTestId("tg-link")).toHaveText("https://t.me/starschannel");
  await page.screenshot({ path: "test-results/boost-carousel.png" });

  // extending stacks: a second purchase is accepted while boosted
  await page
    .getByRole("dialog", { name: "openTelegramLink (mock)" })
    .getByRole("button", { name: "Close" })
    .click();
  await c.getByRole("link").click();
  await page.getByTestId("boost-button").click();
  await page.getByTestId("plan-boost_7d").check({ force: true });
  await page.getByTestId("pay-stars").click();
  await page
    .getByRole("dialog", { name: "Stars payment (mock)" })
    .getByRole("button", { name: "Pay" })
    .click();
  await expect(page.getByTestId("boost-success")).toBeVisible();
});

test("3. boost via simulated GRM (7d): same result, channel link saved before payment", async ({
  page,
}) => {
  const title = "GRM boosted marathon";
  const id = await createChain(page, 43, title); // created WITHOUT a channel
  await page.getByTestId("boost-button").click();
  await expect(page.getByTestId("channel-input")).toHaveValue("");
  await page.getByTestId("plan-boost_7d").check({ force: true });
  await expect(page.getByTestId("pay-stars")).toContainText("500 ⭐");
  await page.getByTestId("channel-input").fill("t.me/grmchannel");

  await expect(page.getByTestId("mock-grm")).toBeVisible();
  await page.getByTestId("grm-create").click();
  const intent = page.getByTestId("grm-intent");
  await expect(intent).toContainText("250 GRM (250000000000 units)");
  const ref = (await intent.locator("dd").first().innerText()).trim();
  expect(ref).toMatch(/^[A-Za-z0-9]{16}$/);
  await page.getByTestId("grm-simulate").click();
  await expect(page.getByTestId("boost-success")).toBeVisible();
  await page.getByTestId("boost-success").getByRole("button", { name: "Done" }).click();

  await page.goto("/?mock_user=43&mock_lang=en");
  const c = card(page, title);
  await expect(c).toBeVisible();
  await c.getByTestId("channel-button").click(); // saved (PATCH) before the payment started
  await expect(page.getByTestId("tg-link")).toHaveText("https://t.me/grmchannel");
  await page
    .getByRole("dialog", { name: "openTelegramLink (mock)" })
    .getByRole("button", { name: "Close" })
    .click();

  // a stranger sees the sponsored chain with its channel link and no boost controls
  await page.goto(`/chain/${id}?mock_user=44&mock_lang=en`);
  await expect(page.getByText("Sponsored").first()).toBeVisible();
  await expect(page.getByTestId("channel-button")).toBeVisible();
  await expect(page.getByTestId("boost-button")).toHaveCount(0);
});

test("4. only the creator can boost; non-boosted chains stay out of the carousel; Expire boost removes a chain", async ({
  page,
}) => {
  // a stranger on a normal chain: no Boost button
  await page.goto("/chain/cat00001?mock_user=45&mock_lang=en");
  await expect(page.getByRole("heading", { name: "Show your cat" })).toBeVisible();
  await expect(page.getByTestId("boost-button")).toHaveCount(0);
  await page.goto("/?mock_user=45&mock_lang=en");
  await expect(card(page, "Show your cat")).toHaveCount(0); // not boosted, not in the carousel

  // the creator boosts through DevTools and then expires it
  const title = "Expiring marathon";
  const id = await createChain(page, 46, title, "@expiringchan");
  await page.getByRole("button", { name: "DevTools (mock)" }).click();
  await page.getByRole("button", { name: "Boost this chain 24h" }).click();
  await expect(page.getByTestId("boost-button")).toContainText("Boosted until");
  await page.goto("/?mock_user=46&mock_lang=en");
  await expect(card(page, title)).toBeVisible();

  await page.goto(`/chain/${id}?mock_user=46&mock_lang=en`);
  await page.getByRole("button", { name: "DevTools (mock)" }).click();
  await page.getByRole("button", { name: "Expire boost" }).click();
  await expect(page.getByTestId("boost-button")).toContainText("Boost marathon");
  await expect(page.getByTestId("channel-button")).toHaveCount(0); // the public link is gone with the boost
  await page.goto("/?mock_user=46&mock_lang=en");
  await expect(card(page, title)).toHaveCount(0);
  // ...and for strangers too (the cached isBoosted flag is still true server-side: only boostedUntil counts)
  await page.goto(`/chain/${id}?mock_user=47&mock_lang=en`);
  await expect(page.getByText("Sponsored")).toHaveCount(0);
  await expect(page.getByTestId("channel-button")).toHaveCount(0);
});

test("channel link validation: an invalid link blocks payment and shows an error", async ({
  page,
}) => {
  await createChain(page, 48, "Validate channel");
  await page.getByTestId("boost-button").click();
  for (const bad of ["https://evil.com/x", "javascript:alert(1)", "https://t.me@evil.com"]) {
    await page.getByTestId("channel-input").fill(bad);
    await page.getByTestId("pay-stars").click();
    await expect(modal(page).getByRole("alert")).toContainText("Use a t.me link");
    await expect(page.getByRole("dialog", { name: "Stars payment (mock)" })).toHaveCount(0); // never reached payment
  }
  // the create form validates too
  await page.goto("/create?mock_user=48&mock_lang=en");
  await page.getByLabel("Topic").fill("Bad link chain");
  await page.getByTestId("create-channel-input").fill("https://evil.com");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert")).toContainText("Use a t.me link");
});

test("on iOS only Stars is offered in the boost modal; cancelled / failed payments boost nothing", async ({
  page,
}) => {
  const title = "iOS marathon";
  await createChain(page, 49, title);
  await page.goto(`/?mock_user=49&mock_lang=en&mock_platform=ios`);
  await page
    .getByRole("link", { name: new RegExp(title) })
    .first()
    .click();
  await page.getByTestId("boost-button").click();
  await expect(page.getByTestId("pay-stars")).toBeVisible();
  await expect(page.getByTestId("mock-grm")).toHaveCount(0);
  await expect(page.getByTestId("grm-unavailable")).toBeVisible();
  await expect(modal(page)).not.toContainText(/\d+ GRM/);

  await page.getByTestId("pay-stars").click();
  await page
    .getByRole("dialog", { name: "Stars payment (mock)" })
    .getByRole("button", { name: "Cancel" })
    .click();
  await expect(modal(page)).toContainText("Payment cancelled");
  await page.getByTestId("pay-stars").click();
  await page
    .getByRole("dialog", { name: "Stars payment (mock)" })
    .getByRole("button", { name: "Fail" })
    .click();
  await expect(modal(page).getByRole("alert")).toContainText("Payment failed");
  await expect(page.getByTestId("boost-success")).toHaveCount(0);
  await page.goto("/?mock_user=49&mock_lang=en");
  await expect(card(page, title)).toHaveCount(0);
});

test("My marathons on the profile show the boost status and a Boost action", async ({ page }) => {
  await createChain(page, 50, "Profile marathon");
  await page.goto("/profile?mock_user=50&mock_lang=en");
  const row = page.getByTestId("my-marathon").filter({ hasText: "Profile marathon" });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText("Boosted");
  await row.getByRole("button", { name: /Boost/ }).click();
  await expect(modal(page)).toBeVisible();
  await page.getByTestId("pay-stars").click();
  await page
    .getByRole("dialog", { name: "Stars payment (mock)" })
    .getByRole("button", { name: "Pay" })
    .click();
  await expect(page.getByTestId("boost-success")).toBeVisible();
  await page.getByTestId("boost-success").getByRole("button", { name: "Done" }).click();
  await expect(row).toContainText("Boosted"); // the list refreshed after the payment
});

test.describe("real (non-mock) build path", () => {
  test.use({ baseURL: "http://localhost:5274" });

  test("real Telegram facade + lazy TonConnect chunk; Stars boost goes through openInvoice and server polling", async ({
    page,
    request,
  }) => {
    const init = await request.post("http://localhost:3100/api/dev/init-data", {
      data: { userId: 1000020, languageCode: "en" },
    });
    const { initData } = (await init.json()) as { initData: string };
    const created = await request.post("http://localhost:3100/api/chains", {
      headers: { authorization: `tma ${initData}` },
      data: { title: "Real boost marathon", channelUrl: "@realchannel1" },
    });
    expect(created.status()).toBe(201);
    const chainId = ((await created.json()) as { id: string }).id;

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
          openTelegramLink: (url: string) => {
            w.__tgLink = url;
          },
          showAlert: (_m: string, cb?: () => void) => cb?.(),
          showConfirm: (_m: string, cb?: (ok: boolean) => void) => cb?.(true),
        },
      };
    }, initData);

    await page.goto(`/chain/${chainId}`);
    await expect(page.getByRole("heading", { name: "Real boost marathon" })).toBeVisible();
    await page.getByTestId("boost-button").click();
    await expect(modal(page)).toBeVisible();

    // GRM: the TonConnect chunk is only fetched once the user picks GRM
    expect(
      await page.evaluate(() =>
        performance.getEntriesByType("resource").some((r) => /TonPay|tonconnect/i.test(r.name)),
      ),
    ).toBe(false);
    await page.getByTestId("open-grm").click();
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
    await expect(page.getByTestId("boost-success")).toBeVisible();
    await page.getByTestId("boost-success").getByRole("button", { name: "Done" }).click();

    // the real facade opens the channel link through Telegram
    await expect(page.getByTestId("channel-button")).toBeVisible();
    await page.getByTestId("channel-button").click();
    expect(await page.evaluate(() => (window as unknown as { __tgLink?: string }).__tgLink)).toBe(
      "https://t.me/realchannel1",
    );
    expect(errors).toEqual([]);
  });
});
