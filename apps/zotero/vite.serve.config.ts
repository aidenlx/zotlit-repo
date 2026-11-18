import { defineConfig, mergeConfig } from "vite";

import { zoteroDevServerPlugin } from "./scripts/dev-server/index.ts";
import { createZoteroViteConfig } from "./vite.config.ts";

const packageRoot = import.meta.dirname;

export default defineConfig((configEnv) =>
  mergeConfig(createZoteroViteConfig(configEnv), {
    plugins: [
      zoteroDevServerPlugin({
        root: packageRoot,
        mode: configEnv.mode,
      }),
    ],
  }),
);
