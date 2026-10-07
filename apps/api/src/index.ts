import { loadConfig } from "./config";
import { buildApp } from "./app";

const config = loadConfig();
const app = await buildApp(config);
await app.listen({ port: config.port, host: "0.0.0.0" });
