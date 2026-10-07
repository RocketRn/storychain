import { loadConfig } from "./config";
import { buildApp } from "./app";
import { createDb } from "./db";
import { createStorage } from "./storage";
import { createBot } from "./bot";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const bot = config.botEnabled ? createBot(config) : undefined;
const app = await buildApp({ config, db, storage: createStorage(config), ...(bot ? { bot } : {}) });
await app.listen({ port: config.port, host: "0.0.0.0" });

if (bot) {
  await bot.init();
  if (config.botMode === "webhook") {
    await bot.api.setWebhook(config.webhookUrl, { secret_token: config.webhookSecret });
    app.log.info("bot: webhook set");
  } else {
    // long polling for development; make sure no webhook is registered
    await bot.api.deleteWebhook();
    void bot.start({
      drop_pending_updates: true,
      onStart: (me) => app.log.info(`bot: polling as @${me.username}`),
    });
  }
  const stop = () => void bot.stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
