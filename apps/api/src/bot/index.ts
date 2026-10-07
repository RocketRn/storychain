import { Bot, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { parseStartParam } from "@storychain/shared";
import type { Config } from "../config";
import type { Db } from "../db";
import { registerPaymentHandlers } from "../payments/stars";

type Lang = "ru" | "en";
const TEXTS: Record<Lang, { welcome: string; chain: string; open: string; openChain: string }> = {
  ru: {
    welcome:
      "Привет! StoryChain — это «Добавь свой» для историй Telegram. Выбери цепочку или запусти свою.",
    chain: "Тебя пригласили в цепочку! Открывай, добавляй своё фото и делись в сторис.",
    open: "Открыть StoryChain",
    openChain: "Открыть цепочку",
  },
  en: {
    welcome: "Hi! StoryChain is “Add Yours” for Telegram Stories. Pick a chain or start your own.",
    chain: "You were invited to a chain! Open it, add your photo and share it to your story.",
    open: "Open StoryChain",
    openChain: "Open chain",
  },
};

const langOf = (code?: string): Lang => (code?.toLowerCase().startsWith("en") ? "en" : "ru");

/** web_app buttons must be https. `tgWebAppStartParam` is read by the client as a start_param fallback. */
export function webAppUrl(config: Pick<Config, "webappUrl">, chainId?: string): string {
  const base = config.webappUrl.replace(/\/$/, "");
  return chainId ? `${base}/?tgWebAppStartParam=chain_${chainId}` : base;
}

async function replyWithApp(ctx: Context, config: Config, chainId?: string): Promise<void> {
  const t = TEXTS[langOf(ctx.from?.language_code)];
  const kb = new InlineKeyboard().webApp(
    chainId ? t.openChain : t.open,
    webAppUrl(config, chainId),
  );
  await ctx.reply(chainId ? t.chain : t.welcome, { reply_markup: kb });
}

export function registerStartHandlers(bot: Bot, config: Config): void {
  bot.command("start", async (ctx) => {
    // `/start chain_<id>`: deep link payload; anything invalid falls back to the plain welcome
    const chainId = parseStartParam(ctx.match.trim());
    await replyWithApp(ctx, config, chainId ?? undefined);
  });
  // Any other private text: just offer the app
  bot.on("message:text", async (ctx) => {
    if (ctx.chat.type === "private") await replyWithApp(ctx, config);
  });
}

export function createBot(config: Config, opts: { db: Db; botInfo?: UserFromGetMe }): Bot {
  const bot = new Bot(config.botToken, opts.botInfo ? { botInfo: opts.botInfo } : {});
  registerPaymentHandlers(bot, { db: opts.db, config }); // before the catch-all text handler
  registerStartHandlers(bot, config);
  bot.catch((err) => console.error("[bot] handler error:", err.message));
  return bot;
}
