import { defineConfig } from "vite";

export default defineConfig({
  base: "/mw/",
  build: {
    outDir: "../../static/mw",
    emptyOutDir: false,
  },
  server: {
    proxy: {
      "/api/mw/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
      },
    },
  },
});
