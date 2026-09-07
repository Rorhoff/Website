import { defineConfig } from "vite";

export default defineConfig({
  base: "/mw/mapbuilder/",
  build: {
    outDir: "../../static/mw/mapbuilder",
    emptyOutDir: true,
  },
});
