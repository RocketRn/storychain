import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "VITE_");
  if (mode === "production" && env.VITE_DEV_MOCK === "true") {
    throw new Error("VITE_DEV_MOCK=true is not allowed in a production build");
  }
  return {
    envDir: "../..",
    plugins: [react()],
    server: { port: 5173, proxy: { "/api": apiTarget, "/uploads": apiTarget } },
  };
});
