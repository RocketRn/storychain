// Generates public/tonconnect-manifest.json from WEBAPP_URL (read from the environment or the root .env).
// The manifest `url` must be the public origin of the Mini App for real wallets.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
let webapp = process.env.WEBAPP_URL;
if (!webapp) {
  try {
    const env = readFileSync(new URL(".env", root), "utf8");
    webapp = /^WEBAPP_URL=(.*)$/m.exec(env)?.[1]?.trim();
  } catch {
    /* no .env yet */
  }
}
const url = (webapp || "http://localhost:5173").replace(/\/$/, "");
const manifest = { url, name: "StoryChain", iconUrl: `${url}/icon-180.png` };
writeFileSync(
  fileURLToPath(new URL("../public/tonconnect-manifest.json", import.meta.url)),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log("tonconnect-manifest.json ->", url);
