import { loadConfig } from "./config";
import { buildApp } from "./app";
import { createDb } from "./db";
import { createStorage } from "./storage";

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = await buildApp({ config, db, storage: createStorage(config) });
await app.listen({ port: config.port, host: "0.0.0.0" });
