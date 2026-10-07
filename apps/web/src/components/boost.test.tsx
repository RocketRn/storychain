import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALL_FONTS, TEMPLATES, parseChannelUrl, type BoostPlanDTO } from "@storychain/shared/light";
import { I18nContext, dictionaries, makeI18n, type Lang } from "../lib/i18n";
import { TemplatePicker } from "../editor/TemplatePicker";
import type { Photo } from "../editor/photo";
import { BoostForm, readChannelInput, type BoostFormProps } from "./BoostModal";

const render = (node: ReactNode, lang: Lang = "en") =>
  renderToStaticMarkup(<I18nContext.Provider value={makeI18n(lang)}>{node}</I18nContext.Provider>);

describe("editor: nothing is locked", () => {
  const photo = { bitmap: {} as ImageBitmap, width: 100, height: 100 } satisfies Photo;
  const html = render(
    <TemplatePicker
      photo={photo}
      title="Show your cat"
      position={3}
      templateId="sunset"
      fontFamily={null}
      onTemplate={() => undefined}
      onFont={() => undefined}
    />,
  );

  it("shows no lock icons, PRO/premium badges or paywall hints", () => {
    expect(html).not.toMatch(/🔒|PRO|premium|paywall|upgrade/i);
  });

  it("renders every template and every font as an enabled button", () => {
    for (const t of TEMPLATES) expect(html).toContain(`data-testid="template-${t.id}"`);
    for (const f of ALL_FONTS) expect(html).toContain(`data-testid="font-${f}"`);
    expect(html).not.toContain("disabled");
    expect((html.match(/<button/g) ?? []).length).toBe(TEMPLATES.length + ALL_FONTS.length);
  });
});

describe("dictionary: the PRO / quota / paywall vocabulary is gone (RU + EN)", () => {
  it("has no PRO, daily-limit, premium-plan or paywall keys or texts", () => {
    for (const lang of ["ru", "en"] as const) {
      for (const [key, text] of Object.entries(dictionaries[lang])) {
        expect(key, `${lang}.${key}`).not.toMatch(
          /^(proChip|proBadge|proActiveUntil|proUnlimited|freeChip|freeWatermark|paywall|benefit|dailyLimit|usedToday|getPro|planName|extendHint)/,
        );
        expect(key).not.toMatch(/DAILY_LIMIT|PRO_REQUIRED/);
        expect(text, `${lang}.${key}`).not.toMatch(/\bPRO\b|paywall/);
      }
    }
  });
  it("has the boost vocabulary in both languages", () => {
    for (const lang of ["ru", "en"] as const) {
      for (const k of [
        "sponsored",
        "hotTitle",
        "openChannel",
        "boostMarathon",
        "boostedUntilExtend",
        "channelLabel",
        "channelHint",
        "boostSuccess",
        "myMarathons",
      ] as const) {
        expect(dictionaries[lang][k].length).toBeGreaterThan(0);
      }
    }
    expect(dictionaries.ru.sponsored).toBe("Реклама");
    expect(dictionaries.en.boostMarathon).toBe("Boost marathon");
    expect(dictionaries.ru.boostMarathon).toBe("Продвинуть марафон");
  });
});

describe("BoostForm: payment methods follow the platform", () => {
  const plans: BoostPlanDTO[] = [
    {
      id: "boost_24h",
      durationHours: 24,
      prices: {
        stars: 100,
        grm: { amount: "50000000000", decimals: 9, symbol: "GRM", display: "50 GRM" },
      },
    },
    {
      id: "boost_7d",
      durationHours: 168,
      prices: {
        stars: 500,
        grm: { amount: "250000000000", decimals: 9, symbol: "GRM", display: "250 GRM" },
      },
    },
  ];
  const base: BoostFormProps = {
    chain: { title: "Show your cat" },
    plans,
    methods: ["stars", "ton_grm"],
    planId: "boost_24h",
    onPlan: () => undefined,
    channel: "",
    onChannel: () => undefined,
    channelError: null,
    busy: false,
    onPayStars: () => undefined,
    grm: <button data-testid="grm-panel">GRM</button>,
  };

  it("desktop: Stars and GRM, with both prices", () => {
    const html = render(<BoostForm {...base} />);
    expect(html).toContain('data-testid="pay-stars"');
    expect(html).toContain('data-testid="grm-panel"');
    expect(html).not.toContain("grm-unavailable");
    expect(html).toContain("100 ⭐ · 50 GRM");
    expect(html).toContain("500 ⭐ · 250 GRM");
    expect(html).toContain("Pay with Stars · 100 ⭐");
  });

  it("iOS/Android (Stars only): no GRM button or price, a hint instead", () => {
    const html = render(<BoostForm {...base} methods={["stars"]} planId="boost_7d" />);
    expect(html).toContain('data-testid="pay-stars"');
    expect(html).not.toContain('data-testid="grm-panel"');
    expect(html).toContain('data-testid="grm-unavailable"');
    expect(html).not.toMatch(/\d+ GRM/); // no GRM price anywhere (only the "unavailable" hint mentions GRM)
    expect(html).toContain("500 ⭐");
    expect(html).toContain("Pay with Stars · 500 ⭐");
  });

  it("GRM-only platforms hide the Stars button", () => {
    const html = render(<BoostForm {...base} methods={["ton_grm"]} />);
    expect(html).not.toContain('data-testid="pay-stars"');
    expect(html).toContain('data-testid="grm-panel"');
  });

  it("shows the selected plan, the channel field with its privacy hint, and validation errors", () => {
    const html = render(
      <BoostForm {...base} channel="@mychannel" channelError="Use a t.me link" />,
      "en",
    );
    expect(html).toContain("Show your cat");
    expect(html).toMatch(/data-testid="plan-boost_24h"[^>]*checked/);
    expect(html).toContain('value="@mychannel"');
    expect(html).toContain("Shown only while the marathon is boosted");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Use a t.me link");
    const ru = render(<BoostForm {...base} />, "ru");
    expect(ru).toContain("Показывается только пока марафон продвигается");
  });

  it("disables paying while a payment is in progress", () => {
    expect(render(<BoostForm {...base} busy />)).toMatch(
      /<button[^>]*disabled[^>]*data-testid="pay-stars"/,
    );
  });
});

describe("client-side channelUrl validation mirrors the shared schema", () => {
  const samples = [
    "t.me/catsclub",
    "@catsclub",
    "https://t.me/+AbCdEfGhIjKl",
    "",
    "   ",
    "https://evil.com/x",
    "javascript:alert(1)",
    "https://t.me@evil.com",
    "has space",
    "x".repeat(200),
    "@abc",
  ];
  it.each(samples)("agrees with parseChannelUrl on %j", (input) => {
    const shared = parseChannelUrl(input);
    const client = readChannelInput(input);
    if (shared.ok) expect(client).toBe(shared.value);
    else expect(client).toBeUndefined();
  });
});
