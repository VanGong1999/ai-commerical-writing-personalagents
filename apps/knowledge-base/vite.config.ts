import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { localUiGuard } from "../../scripts/local-ui-guard.mjs";

export default defineConfig({
  plugins: [localUiGuard(), react()],
  server: { host: "127.0.0.1", port: 5174 },
  preview: { host: "127.0.0.1" },
});
