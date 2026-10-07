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
    build: {
      rollupOptions: {
        output: {
          // The framework changes a few times a year, the app on every deploy. Keeping them in separate files lets a
          // returning user (Telegram's WebView keeps its cache between launches) re-download only the app code.
          manualChunks(id) {
            if (
              /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@tanstack)\//.test(
                id,
              )
            )
              return "vendor";
            return undefined;
          },
        },
      },
    },
    server: {
      port: 5173,
      allowedHosts: true /* dev server only: lets a tunnel host name through */,
      proxy: { "/api": apiTarget, "/uploads": apiTarget },
    },
  };
});
