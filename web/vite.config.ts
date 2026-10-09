import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5743,
    strictPort: true,
    // The Origin header passes through unchanged, so the server sees
    // http://localhost:5743 — which its default config allows.
    proxy: { "/api": "http://127.0.0.1:8742" },
  },
});
