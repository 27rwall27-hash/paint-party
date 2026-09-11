import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        suite: fileURLToPath(new URL("./index.html", import.meta.url)),
        paintParty: fileURLToPath(new URL("./paint-party/index.html", import.meta.url)),
        stampedeSprint: fileURLToPath(new URL("./stampede-sprint/index.html", import.meta.url)),
        lightMaze: fileURLToPath(new URL("./light-maze/index.html", import.meta.url)),
        diceyDecisions: fileURLToPath(new URL("./dicey-decisions/index.html", import.meta.url)),
        cauldronChaos: fileURLToPath(new URL("./cauldron-chaos/index.html", import.meta.url)),
      },
    },
  },
});
