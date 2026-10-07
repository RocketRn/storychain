// Boots the REAL server in single-origin mode (API + built web app on one port) and checks it over HTTP.
// Prerequisite: `pnpm build`.   Run: pnpm smoke
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import sharp from "sharp";

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const BOT_TOKEN = "123456:smoke-test-token";
const env = {
  ...process.env,
  NODE_ENV: "development",
  DEV_MODE: "false",
  SERVE_WEB: "true",
  PORT: String(PORT),
  DATABASE_URL: "file:./smoke.db",
  UPLOAD_DIR: "./uploads/smoke",
  PUBLIC_BASE_URL: BASE,
  BOT_TOKEN,
  BOT_USERNAME: "smoke_bot",
  BOT_ENABLED: "false",
};

if (!existsSync("apps/web/dist/index.html")) {
  console.error("apps/web/dist is missing: run `pnpm build` first");
  process.exit(1);
}
let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : ` ${extra}`}`);
  if (!ok) failed++;
};

// -1. the production bundle must not contain any mock / test-hook code
const dist = "apps/web/dist/assets";
const forbidden = [
  "/api/dev/",
  "__storychain",
  "mock-invoice",
  "storychain.mock",
  "Simulate GRM",
  "tgMock",
];
const leaks = readdirSync(dist)
  .filter((f) => f.endsWith(".js"))
  .flatMap((f) =>
    forbidden
      .filter((m) => readFileSync(`${dist}/${f}`, "utf8").includes(m))
      .map((m) => `${f}: ${m}`),
  );
check("production bundle contains no mock/dev code", leaks.length === 0, leaks.join(", "));

// -1b. Vite reads NODE_ENV from the root .env, and the default .env says "development": a build made beside it
// ships React's DEVELOPMENT build (about twice the size, several times slower). Only that build prints this hint.
const devReact = readdirSync(dist)
  .filter((f) => f.endsWith(".js"))
  .filter((f) => readFileSync(`${dist}/${f}`, "utf8").includes("Download the React DevTools"));
check(
  "web bundle is a production build (no development React inside)",
  devReact.length === 0,
  `found in ${devReact.join(", ")}: build with NODE_ENV=production`,
);

// 0. the production safety guard
const guard = spawnSync("pnpm", ["--filter", "@storychain/api", "start"], {
  env: { ...env, NODE_ENV: "production", DEV_MODE: "true" },
  encoding: "utf8",
});
check(
  "API refuses DEV_MODE=true with NODE_ENV=production",
  guard.status !== 0 && /DEV_MODE/.test(guard.stderr + guard.stdout),
);

rmSync("apps/api/prisma/smoke.db", { force: true });
rmSync("apps/api/prisma/smoke.db-journal", { force: true });
rmSync("apps/api/uploads/smoke", { recursive: true, force: true });
spawnSync("pnpm", ["--filter", "@storychain/api", "db:deploy"], { env, stdio: "ignore" });

const server = spawn("pnpm", ["--filter", "@storychain/api", "start"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let log = "";
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));
const stop = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function initData(user) {
  const p = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const dcs = [...p.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  p.set("hash", createHmac("sha256", secret).update(dcs).digest("hex"));
  return p.toString();
}

try {
  check("server starts", await waitUp(), log.slice(-500));
  if (failed) throw new Error("server did not start");

  const index = await fetch(`${BASE}/`);
  const html = await index.text();
  check("GET / serves the SPA", index.status === 200 && html.includes('id="root"'));
  check("index.html is not cached", index.headers.get("cache-control") === "no-cache");
  const csp = index.headers.get("content-security-policy") ?? "";
  check(
    "CSP allows telegram.org script + Telegram Web framing",
    csp.includes("https://telegram.org") && csp.includes("web.telegram.org"),
  );
  check("no X-Frame-Options (framing is governed by CSP)", !index.headers.get("x-frame-options"));

  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  const a = asset ? await fetch(BASE + asset) : null;
  check(
    "hashed asset is served immutable",
    a?.status === 200 && /immutable/.test(a.headers.get("cache-control") ?? ""),
  );
  check(
    "deep link route falls back to the SPA",
    (await (await fetch(`${BASE}/chain/abc12345`)).text()).includes('id="root"'),
  );
  check(
    "fonts are served",
    (await fetch(`${BASE}/fonts/inter-latin-700-normal.woff2`)).status === 200,
  );
  const manifest = await fetch(`${BASE}/tonconnect-manifest.json`);
  check(
    "TonConnect manifest is served with CORS *",
    manifest.status === 200 && manifest.headers.get("access-control-allow-origin") === "*",
  );

  check("API is JSON: /api/health", (await (await fetch(`${BASE}/api/health`)).json()).ok === true);
  const noAuth = await fetch(`${BASE}/api/chains`);
  check(
    "API requires auth (401 JSON)",
    noAuth.status === 401 && (await noAuth.json()).error.code === "UNAUTHORIZED",
  );
  check(
    "unknown /api path is a JSON 404",
    (await fetch(`${BASE}/api/nope`)).headers.get("content-type")?.includes("json") === true,
  );
  check(
    "dev endpoints are absent (DEV_MODE=false)",
    (await fetch(`${BASE}/api/dev/init-data`, { method: "POST" })).status === 404,
  );

  // the Hot carousel endpoint (public clients need auth like every other endpoint)
  const boostedNoAuth = await fetch(`${BASE}/api/chains/boosted`);
  check("GET /api/chains/boosted requires auth", boostedNoAuth.status === 401);

  // full flow through the real HTTP stack: auth -> create chain -> upload -> fetch the image from the same origin
  const auth = {
    Authorization: `tma ${initData({ id: 777001, first_name: "Smoke", language_code: "en" })}`,
  };
  const session = await (
    await fetch(`${BASE}/api/auth/session`, { method: "POST", headers: auth })
  ).json();
  check("auth session", session.user?.telegramId === "777001");
  const chain = await (
    await fetch(`${BASE}/api/chains`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ title: "Smoke chain", channelUrl: "@smokechannel" }),
    })
  ).json();
  check("create chain", /^[A-Za-z0-9_-]{8}$/.test(chain.id ?? ""));
  const boostedRes = await fetch(`${BASE}/api/chains/boosted`, { headers: auth });
  const boosted = await boostedRes.json();
  check(
    "GET /api/chains/boosted returns a JSON list (a fresh chain is not in it)",
    boostedRes.status === 200 && Array.isArray(boosted) && !boosted.some((c) => c.id === chain.id),
  );
  const plans = await (await fetch(`${BASE}/api/plans`, { headers: auth })).json();
  check(
    "GET /api/plans returns the boost plans (no PRO plan)",
    plans.boostPlans?.map((p) => p.id).join() === "boost_24h,boost_7d" && plans.plans === undefined,
  );
  const jpeg = await sharp({
    create: { width: 1080, height: 1920, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
  const fd = new FormData();
  fd.append("templateId", "sunset");
  fd.append("image", new Blob([jpeg], { type: "image/jpeg" }), "card.jpg");
  const posted = await fetch(`${BASE}/api/chains/${chain.id}/posts`, {
    method: "POST",
    headers: auth,
    body: fd,
  });
  const post = await posted.json();
  check(
    "upload card (multipart)",
    posted.status === 201 && post.post?.position === 1,
    JSON.stringify(post).slice(0, 200),
  );
  check(
    "share link is built from BOT_USERNAME",
    post.shareLink === `https://t.me/smoke_bot?startapp=chain_${chain.id}`,
  );
  const img = await fetch(post.publicImageUrl);
  check(
    "uploaded image is served from the same origin as JPEG",
    img.status === 200 &&
      img.headers.get("content-type") === "image/jpeg" &&
      post.publicImageUrl.startsWith(BASE),
  );
} catch (e) {
  console.error(String(e));
  failed++;
} finally {
  stop();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nsingle-origin smoke test passed");
process.exit(failed ? 1 : 0);
