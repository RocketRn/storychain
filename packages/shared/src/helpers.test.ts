import { describe, expect, it } from "vitest";
import { buildShareLink, normalizeChainInput, parseStartParam } from "./helpers";
import { createChainSchema } from "./schemas";

describe("normalizeChainInput mirrors createChainSchema", () => {
  const cases: Array<Parameters<typeof normalizeChainInput>[0]> = [
    { title: "ab" },
    { title: "abc" },
    { title: "  padded title  " },
    { title: "x".repeat(80) },
    { title: "x".repeat(81) },
    { title: "ok title", description: "d".repeat(300) },
    { title: "ok title", description: "d".repeat(301) },
    { title: "ok title", emoji: "🐱" },
    { title: "ok title", emoji: "e".repeat(9) },
    { title: "ok title", emoji: "  ", description: "  " },
  ];
  it.each(cases)("agrees on %j", (input) => {
    const server = createChainSchema.safeParse(input);
    const client = normalizeChainInput(input);
    expect(client !== null).toBe(server.success);
    if (server.success && client) {
      expect(client.title).toBe(server.data.title);
      // whitespace-only optionals: zod keeps "" while the client drops them; both are "empty"
      expect(client.emoji ?? "").toBe(server.data.emoji ?? "");
      expect(client.description ?? "").toBe(server.data.description ?? "");
    }
  });
});

describe("deep links", () => {
  it("parses chain_<id> start params only", () => {
    expect(parseStartParam("chain_abc12345")).toBe("abc12345");
    for (const bad of ["chain_", "x_abc", "chain_a b", "chain_<s>", "", null, undefined])
      expect(parseStartParam(bad)).toBeNull();
  });
  it("builds main and short-name links", () => {
    expect(buildShareLink({ botUsername: "bot", chainId: "id1" })).toBe(
      "https://t.me/bot?startapp=chain_id1",
    );
    expect(buildShareLink({ botUsername: "bot", appShortName: "app", chainId: "id1" })).toBe(
      "https://t.me/bot/app?startapp=chain_id1",
    );
  });
});
