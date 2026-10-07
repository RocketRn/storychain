import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Wallets show the manifest's `url` and refuse a manifest that does not belong to the app that asked. The web
 * build writes it from WEBAPP_URL; a build made without that variable silently ships "http://localhost:5173",
 * after which every GRM payment fails inside the wallet and nothing on the server side hints at why.
 * Compares origins only (a trailing slash or path must not matter). No manifest file = hosted elsewhere = skip.
 */
export function assertManifestMatches(distDir: string, webappUrl: string): void {
  const file = join(distDir, "tonconnect-manifest.json");
  if (!existsSync(file)) return;
  let url: unknown;
  try {
    url = (JSON.parse(readFileSync(file, "utf8")) as { url?: unknown }).url;
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  const origin = (u: string): string | null => {
    try {
      return new URL(u).origin;
    } catch {
      return null;
    }
  };
  if (typeof url !== "string" || origin(url) === null || origin(url) !== origin(webappUrl)) {
    throw new Error(
      `The TonConnect manifest ${file} says url=${JSON.stringify(url)} but WEBAPP_URL is ${webappUrl}. ` +
        "Rebuild the web app with WEBAPP_URL set (pnpm build), otherwise wallets reject GRM payments.",
    );
  }
}
