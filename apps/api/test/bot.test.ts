import { afterAll, describe, expect, it } from "vitest";
import type { Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { buildApp } from "../src/app";
import { createBot, webAppUrl } from "../src/bot";
import { loadConfig } from "../src/config";
import { createDb } from "../src/db";
import { BOT_TOKEN, MemoryStorage } from "./helpers";

const botInfo = {
  id: 99,
  is_bot: true,
  first_name: "StoryChain",
  username: "storychain_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as unknown as UserFromGetMe;

const env = (extra: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: "test",
    BOT_TOKEN,
    WEBAPP_URL: "https://app.example.com/",
    ...extra,
  } as NodeJS.ProcessEnv);

interface Call {
  method: string;
  payload: Record<string, unknown>;
}

/** A bot whose Bot API transport is replaced by a recorder (no network). */
function recordingBot(config = env()): { bot: Bot; calls: Call[] } {
  const bot = createBot(config, { botInfo });
  const calls: Call[] = [];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    return {
      ok: true,
      result: { message_id: 1, date: 0, chat: { id: 5, type: "private" } },
    } as never;
  });
  return { bot, calls };
}

const textUpdate = (text: string, languageCode = "en", chatType = "private") => ({
  update_id: 1,
  message: {
    message_id: 1,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 5, type: chatType, first_name: "A" },
    from: { id: 5, is_bot: false, first_name: "A", language_code: languageCode },
    text,
    ...(text.startsWith("/")
      ? { entities: [{ type: "bot_command", offset: 0, length: text.split(" ")[0]?.length ?? 0 }] }
      : {}),
  },
});

type Btn = { text: string; web_app: { url: string } };
const button = (c: Call): Btn => {
  const kb = (c.payload.reply_markup as { inline_keyboard: Btn[][] }).inline_keyboard;
  return (kb[0] as Btn[])[0] as Btn;
};

describe("bot /start", () => {
  it("replies with a web_app button opening the Mini App", async () => {
    const { bot, calls } = recordingBot();
    await bot.handleUpdate(textUpdate("/start") as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("sendMessage");
    expect(button(calls[0] as Call)).toEqual({
      text: "Open StoryChain",
      web_app: { url: "https://app.example.com" },
    });
  });

  it("/start chain_<id> opens that chain (start param passed via tgWebAppStartParam)", async () => {
    const { bot, calls } = recordingBot();
    await bot.handleUpdate(textUpdate("/start chain_abc12345") as never);
    expect(button(calls[0] as Call)).toEqual({
      text: "Open chain",
      web_app: { url: "https://app.example.com/?tgWebAppStartParam=chain_abc12345" },
    });
  });

  it("ignores malformed payloads and localizes (ru default)", async () => {
    const { bot, calls } = recordingBot();
    await bot.handleUpdate(textUpdate("/start chain_<script>", "ru") as never);
    expect(button(calls[0] as Call).text).toBe("Открыть StoryChain");
    expect(button(calls[0] as Call).web_app.url).toBe("https://app.example.com");
    await bot.handleUpdate(textUpdate("/start something_else", "de") as never);
    expect(button(calls[1] as Call).text).toBe("Открыть StoryChain");
  });

  it("offers the app for any private text but stays quiet in groups", async () => {
    const { bot, calls } = recordingBot();
    await bot.handleUpdate(textUpdate("hello") as never);
    expect(calls).toHaveLength(1);
    await bot.handleUpdate(textUpdate("hello", "en", "supergroup") as never);
    expect(calls).toHaveLength(1);
  });

  it("webAppUrl builds the chain URL", () => {
    expect(webAppUrl({ webappUrl: "https://x.test/" }, "id1")).toBe(
      "https://x.test/?tgWebAppStartParam=chain_id1",
    );
  });
});

describe("webhook endpoint", () => {
  const config = env({
    BOT_MODE: "webhook",
    WEBHOOK_SECRET: "s3cret",
    WEBHOOK_URL: "https://api.example.com/api/telegram/webhook",
  });
  const { bot, calls } = recordingBot(config);
  const db = createDb(process.env.TEST_DATABASE_URL as string);
  const appPromise = buildApp({ config, db, storage: new MemoryStorage(), bot });

  afterAll(async () => {
    await (await appPromise).close();
    await db.$disconnect();
  });

  it("rejects requests without the secret token header", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      payload: textUpdate("/start"),
    });
    expect(res.statusCode).toBe(401);
    const wrong = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "nope" },
      payload: textUpdate("/start"),
    });
    expect(wrong.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("processes updates carrying the right secret", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "POST",
      url: "/api/telegram/webhook",
      headers: { "x-telegram-bot-api-secret-token": "s3cret" },
      payload: textUpdate("/start chain_zzzz1111"),
    });
    expect(res.statusCode).toBe(200);
    expect(calls.some((c) => c.method === "sendMessage")).toBe(true);
  });

  it("is not registered in polling mode", async () => {
    const poll = await buildApp({ config: env(), db, storage: new MemoryStorage(), bot });
    const res = await poll.inject({ method: "POST", url: "/api/telegram/webhook", payload: {} });
    expect(res.statusCode).toBe(404);
    await poll.close();
  });
});
