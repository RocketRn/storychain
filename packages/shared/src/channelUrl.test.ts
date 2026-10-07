import { describe, expect, it } from "vitest";
import { normalizeChainInput, normalizeChannelUrl, parseChannelUrl } from "./helpers";
import { channelUrlSchema, createChainSchema, patchChainSchema } from "./schemas";

const ok: Array<[string, string | null]> = [
  ["t.me/storychain", "https://t.me/storychain"],
  ["https://t.me/storychain", "https://t.me/storychain"],
  ["http://t.me/storychain", "https://t.me/storychain"],
  ["HTTPS://T.ME/StoryChain_1", "https://t.me/StoryChain_1"], // case of the name is kept
  ["@storychain", "https://t.me/storychain"],
  ["https://t.me/storychain/", "https://t.me/storychain"],
  ["  @storychain  ", "https://t.me/storychain"], // pasted whitespace is trimmed
  ["https://t.me/+AbCdEfGhIjKl", "https://t.me/+AbCdEfGhIjKl"],
  ["t.me/+AbC-dEf_GhIjKl", "https://t.me/+AbC-dEf_GhIjKl"],
  ["https://t.me/joinchat/AbCdEfGhIjKl", "https://t.me/joinchat/AbCdEfGhIjKl"],
  ["https://t.me/abcde", "https://t.me/abcde"], // 5 chars: minimum
  [`@a${"b".repeat(31)}`, `https://t.me/a${"b".repeat(31)}`], // 32 chars: maximum
  ["", null],
  ["   ", null],
];

const bad = [
  "https://evil.com/x",
  "https://evil.com/t.me/storychain",
  "https://t.me.evil.com/storychain",
  "https://evil.com/?u=https://t.me/storychain",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "https://t.me@evil.com",
  "https://t.me@evil.com/storychain",
  "https://user:pass@t.me/storychain",
  "ftp://t.me/storychain",
  "//t.me/storychain",
  "https://t.me/storychain?start=1",
  "https://t.me/storychain#x",
  "https://t.me/storychain/123", // post links are not channel links
  "https://t.me/s/storychain",
  "https://t.me/joinchat",
  "https://t.me/share",
  "https://t.me/+short",
  "https://t.me/joinchat/short",
  "https://t.me/",
  "https://t.me",
  "t.me",
  "@ab", // too short
  "@1abcde", // starts with a digit
  "@_abcde",
  "@abc-def", // dash is not allowed in usernames
  `@a${"b".repeat(32)}`, // 33 chars
  "@@storychain",
  "https://t.me/story chain",
  "https://t.me/story\tchain",
  "https://t.me/story\nchain",
  "@story chain",
  "storychain", // no @ / host
  "https://t.me/сtorychain", // cyrillic lookalike "с"
  `https://t.me/${"a".repeat(100)}`, // > 100 chars
  `https://t.me/+${"A".repeat(100)}`,
];

describe("parseChannelUrl / normalizeChannelUrl", () => {
  it.each(ok)("accepts %j -> %j", (input, expected) => {
    expect(parseChannelUrl(input)).toEqual({ ok: true, value: expected });
    expect(normalizeChannelUrl(input)).toBe(expected);
  });

  it.each(bad)("rejects %j", (input) => {
    expect(parseChannelUrl(input)).toEqual({ ok: false });
    expect(() => normalizeChannelUrl(input)).toThrow("INVALID_CHANNEL_URL");
  });

  it("accepts the longest valid invite link (64-char hash) and rejects anything over 100 chars", () => {
    const longest = `https://t.me/+${"A".repeat(64)}`;
    expect(longest.length).toBeLessThanOrEqual(100);
    expect(parseChannelUrl(longest).ok).toBe(true);
    expect(parseChannelUrl(`https://t.me/+${"A".repeat(65)}`).ok).toBe(false);
    expect(parseChannelUrl(`${longest}${"A".repeat(40)}`).ok).toBe(false);
  });

  it("is idempotent on its own output", () => {
    for (const [input] of ok) {
      const once = normalizeChannelUrl(input);
      if (once) expect(normalizeChannelUrl(once)).toBe(once);
    }
  });
});

describe("zod schemas", () => {
  it("channelUrlSchema transforms and tags failures with INVALID_CHANNEL_URL", () => {
    expect(channelUrlSchema.parse("@storychain")).toBe("https://t.me/storychain");
    expect(channelUrlSchema.parse("")).toBeNull();
    const r = channelUrlSchema.safeParse("https://evil.com");
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe("INVALID_CHANNEL_URL");
    expect(channelUrlSchema.safeParse("x".repeat(500)).success).toBe(false);
  });

  it("createChainSchema accepts an optional channelUrl", () => {
    expect(
      createChainSchema.parse({ title: "Cats!", channelUrl: "t.me/catsclub" }).channelUrl,
    ).toBe("https://t.me/catsclub");
    expect(createChainSchema.parse({ title: "Cats!" }).channelUrl).toBeUndefined();
    expect(
      createChainSchema.safeParse({ title: "Cats!", channelUrl: "https://evil.com" }).success,
    ).toBe(false);
  });

  it("patchChainSchema: partial, nullable, strict (no title), non-empty", () => {
    expect(patchChainSchema.parse({ channelUrl: null })).toEqual({ channelUrl: null });
    expect(patchChainSchema.parse({ channelUrl: "" })).toEqual({ channelUrl: null });
    expect(patchChainSchema.parse({ emoji: "🐱", description: "d" })).toEqual({
      emoji: "🐱",
      description: "d",
    });
    expect(patchChainSchema.safeParse({ title: "new title" }).success).toBe(false);
    expect(patchChainSchema.safeParse({}).success).toBe(false);
    expect(patchChainSchema.safeParse({ channelUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("client mirror: normalizeChainInput validates channelUrl like the schema", () => {
    expect(normalizeChainInput({ title: "Cats!", channelUrl: "@catsclub" })?.channelUrl).toBe(
      "https://t.me/catsclub",
    );
    expect(normalizeChainInput({ title: "Cats!", channelUrl: "" })).toEqual({ title: "Cats!" });
    expect(normalizeChainInput({ title: "Cats!", channelUrl: "https://evil.com" })).toBeNull();
  });
});
