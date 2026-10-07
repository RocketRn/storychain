import { describe, expect, it, vi } from "vitest";
import type { StoryParams } from "./tg";
import {
  buildSendToChatUrl,
  buildStoryParams,
  buildStoryText,
  shareToStoryFlow,
  STORY_TEXT_MAX,
  WIDGET_NAME_MAX,
  type ShareDeps,
} from "./share";

const link = "https://t.me/storychain_bot?startapp=chain_abc12345";
const base = { link, title: "Show your cat", emoji: "🐱", lang: "en" as const };

describe("buildStoryText", () => {
  it("contains the deep link in plain text", () => {
    const t = buildStoryText(base);
    expect(t).toContain(link);
    expect(t).toBe(`🐱 «Show your cat»\n🔗 Join: ${link}`);
  });
  it("never exceeds 200 chars and never cuts the link, even for huge titles", () => {
    for (const title of ["x".repeat(500), "Очень длинное название ".repeat(30), "🐱".repeat(200)]) {
      for (const lang of ["ru", "en"] as const) {
        const t = buildStoryText({ ...base, title, lang });
        expect(t.length).toBeLessThanOrEqual(STORY_TEXT_MAX);
        expect(t).toContain(link);
      }
    }
  });
  it("works without an emoji", () =>
    expect(buildStoryText({ ...base, emoji: null })).toMatch(/^«Show your cat»/));
});

describe("buildStoryParams", () => {
  it("adds widget_link only for Premium authors", () => {
    expect(buildStoryParams({ ...base, isPremium: false }).widget_link).toBeUndefined();
    const p = buildStoryParams({ ...base, isPremium: true });
    expect(p.widget_link?.url).toBe(link);
    expect(p.text).toContain(link); // link stays in the text for Premium too
  });
  it("keeps widget name within 48 chars in both languages", () => {
    for (const lang of ["ru", "en"] as const) {
      expect(
        buildStoryParams({ ...base, lang, isPremium: true }).widget_link?.name?.length,
      ).toBeLessThanOrEqual(WIDGET_NAME_MAX);
    }
  });
});

describe("buildSendToChatUrl", () => {
  it("encodes link and text", () => {
    const u = new URL(buildSendToChatUrl(base));
    expect(u.origin + u.pathname).toBe("https://t.me/share/url");
    expect(u.searchParams.get("url")).toBe(link);
    expect(u.searchParams.get("text")).toContain("Show your cat");
  });
});

function makeDeps(
  over: { premium?: boolean; version?: boolean; share?: () => void; download?: boolean } = {},
) {
  const shareToStory = vi.fn<(url: string, params?: StoryParams) => void>(
    over.share ?? (() => undefined),
  );
  const downloadFile = vi.fn();
  const openLink = vi.fn();
  const showAlert = vi.fn(async () => undefined);
  const copy = vi.fn(async () => undefined);
  const markShared = vi.fn(async () => undefined);
  const deps: ShareDeps = {
    tg: {
      user: { id: 1, first_name: "A", is_premium: over.premium ?? false },
      isVersionAtLeast: () => over.version ?? true,
      shareToStory,
      openLink,
      showAlert,
      ...(over.download ? { downloadFile } : {}),
    },
    copy,
    markShared,
  };
  return { deps, shareToStory, downloadFile, openLink, showAlert, copy, markShared };
}
const args = { ...base, postId: "p1", mediaUrl: "https://cdn.example.com/p1.jpg" };

describe("shareToStoryFlow", () => {
  it("non-Premium: shares with text only and marks the post shared", async () => {
    const d = makeDeps();
    expect(await shareToStoryFlow(args, d.deps)).toBe("story");
    expect(d.shareToStory).toHaveBeenCalledOnce();
    const [url, params] = d.shareToStory.mock.calls[0] as unknown as [
      string,
      { text: string; widget_link?: unknown },
    ];
    expect(url).toBe(args.mediaUrl);
    expect(params.widget_link).toBeUndefined();
    expect(params.text).toContain(link);
    expect(d.markShared).toHaveBeenCalledWith("p1");
    expect(d.showAlert).not.toHaveBeenCalled();
  });

  it("Premium: passes widget_link", async () => {
    const d = makeDeps({ premium: true });
    await shareToStoryFlow(args, d.deps);
    const params = d.shareToStory.mock.calls[0]?.[1];
    expect(params?.widget_link?.url).toBe(link);
  });

  it("Premium + widget_link rejected: retries once without it", async () => {
    let n = 0;
    const d = makeDeps({
      premium: true,
      share: () => {
        if (n++ === 0) throw new Error("WEBAPP_STORY_WIDGET_NOT_ALLOWED");
      },
    });
    expect(await shareToStoryFlow(args, d.deps)).toBe("story");
    expect(d.shareToStory).toHaveBeenCalledTimes(2);
    expect(d.shareToStory.mock.calls[1]?.[1]?.widget_link).toBeUndefined();
    expect(d.markShared).toHaveBeenCalled();
  });

  it("old client (< 7.8): fallback = open image, copy link, explain; not marked shared", async () => {
    const d = makeDeps({ version: false });
    expect(await shareToStoryFlow(args, d.deps)).toBe("fallback");
    expect(d.shareToStory).not.toHaveBeenCalled();
    expect(d.openLink).toHaveBeenCalledWith(args.mediaUrl);
    expect(d.copy).toHaveBeenCalledWith(link);
    expect(d.showAlert).toHaveBeenCalledOnce();
    expect(d.markShared).not.toHaveBeenCalled();
  });

  it("fallback prefers downloadFile when the client has it", async () => {
    const d = makeDeps({ version: false, download: true });
    await shareToStoryFlow(args, d.deps);
    expect(d.downloadFile).toHaveBeenCalledWith({
      url: args.mediaUrl,
      file_name: "storychain-card.jpg",
    });
    expect(d.openLink).not.toHaveBeenCalled();
  });

  it("shareToStory throwing without widget also falls back; clipboard failure is tolerated", async () => {
    const d = makeDeps({
      share: () => {
        throw new Error("boom");
      },
    });
    d.copy.mockRejectedValueOnce(new Error("denied"));
    expect(await shareToStoryFlow(args, d.deps)).toBe("fallback");
    expect(d.showAlert).toHaveBeenCalledOnce();
  });

  it("a failing analytics call does not break sharing", async () => {
    const d = makeDeps();
    d.markShared.mockRejectedValueOnce(new Error("offline"));
    await expect(shareToStoryFlow(args, d.deps)).resolves.toBe("story");
  });
});
