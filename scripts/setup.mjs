// One-shot local setup: create .env if missing, generate the Prisma client, migrate and seed the SQLite DB.
import { copyFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("created .env from .env.example (mock mode: DEV_MODE=true, VITE_DEV_MOCK=true)");
} else {
  console.log(".env already exists, leaving it untouched");
}
run("pnpm --filter @storychain/api db:generate");
run("pnpm --filter @storychain/api db:deploy");
run("pnpm --filter @storychain/api db:seed");
console.log(
  "\nDone. Start everything with:  pnpm dev   (web http://localhost:5173, api http://localhost:3000)",
);
