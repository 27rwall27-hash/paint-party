import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        suite: fileURLToPath(new URL("./index.html", import.meta.url)),
        paintParty: fileURLToPath(new URL("./paint-party/index.html", import.meta.url)),
        comingSoon: fileURLToPath(new URL("./coming-soon/index.html", import.meta.url)),
      },
    },
  },
});
