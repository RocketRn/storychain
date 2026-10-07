import { loadConfig } from "./config";
import { buildApp } from "./app";
import { createDb } from "./db";
import { createStorage } from "./storage";
import { createBot } from "./bot";
import { startBoostSweeper } from "./boosts";
import { TonApiIndexer } from "./payments/tonIndexer";
import { TonVerifier } from "./payments/tonVerifier";
import { runTonStartupCheck, tonPaymentsEnabled } from "./payments/tonStartupCheck";
import { closeAndDrain, createShutdown } from "./shutdown";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const bot = config.botEnabled ? createBot(config, { db }) : undefined;

// TON: real indexer + verifier only outside mock mode. A decimals mismatch refuses to start (throws here).
let indexer: TonApiIndexer | undefined;
let verifier: TonVerifier | undefined;
if (!config.devMode && tonPaymentsEnabled(config)) {
  const log = {
    info: (o: unknown, m?: string) => console.info("[ton]", m ?? "", o),
    warn: (o: unknown, m?: string) => console.warn("[ton]", m ?? "", o),
  };
  indexer = new TonApiIndexer({
    apiKey: config.ton.apiKey,
    network: config.ton.network,
    logger: log,
  });
  await runTonStartupCheck({ config, indexer, logger: log });
  verifier = new TonVerifier({
    db,
    indexer,
    config: { jettonMaster: config.ton.jettonMaster, merchantAddress: config.ton.merchantAddress },
  });
}

const app = await buildApp({
  config,
  db,
  storage: createStorage(config),
  ...(bot ? { bot } : {}),
  ...(indexer ? { indexer } : {}),
  ...(verifier ? { verifier } : {}),
});
await app.listen({ port: config.port, host: "0.0.0.0" });
verifier?.start(10_000);
// housekeeping only: boost correctness never depends on this job (everything reads boostedUntil > now)
const sweeper = startBoostSweeper(db);

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
}

// Stop producing work, let in-flight requests (uploads, payment webhooks) finish, close the DB, exit.
const shutdown = createShutdown({
  stop: [() => verifier?.stop(), () => sweeper.stop(), () => (bot ? bot.stop() : undefined)],
  close: [() => closeAndDrain(app), () => db.$disconnect()],
  log: (m, d) => app.log.info(d ?? {}, m),
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => void shutdown(sig));
