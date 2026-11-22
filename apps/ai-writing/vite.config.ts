import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { localUiGuard } from "../../scripts/local-ui-guard.mjs";

const localToken = process.env.LOCAL_API_TOKEN || loadEnv("development", fileURLToPath(new URL("../..", import.meta.url)), "LOCAL_API_").LOCAL_API_TOKEN;

export default defineConfig({
  plugins: [localUiGuard(), react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@tanstack")) return "tanstack-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("victory")) {
            return "charts-vendor";
          }
          if (id.includes("framer-motion") || id.includes("/motion-")) {
            return "motion-vendor";
          }
          if (id.includes("react-dom") || id.includes("/scheduler")) return "react-dom-vendor";
          if (id.includes("/react") || id.includes("react/")) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    fs: {
      allow: [fileURLToPath(new URL("../..", import.meta.url))],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        headers: localToken ? { "X-XZM-Local-Token": localToken } : {},
      },
    },
  },
  preview: { host: "127.0.0.1" },
});
