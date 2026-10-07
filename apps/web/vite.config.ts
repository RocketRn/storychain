import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "VITE_");
  if (mode === "production" && env.VITE_DEV_MOCK === "true") {
    throw new Error("VITE_DEV_MOCK=true is not allowed in a production build");
  }
  return {
    envDir: "../..",
    plugins: [
      react(),
      ...(process.env.ANALYZE
        ? [
            visualizer({
              filename: process.env.ANALYZE === "json" ? "dist/stats.json" : "dist/stats.html",
              template: process.env.ANALYZE === "json" ? "raw-data" : "treemap",
              gzipSize: true,
            }),
          ]
        : []),
    ],
    server: {
      port: 5173,
      allowedHosts: true /* dev server only: lets a tunnel host name through */,
      proxy: { "/api": apiTarget, "/uploads": apiTarget },
    },
  };
});
