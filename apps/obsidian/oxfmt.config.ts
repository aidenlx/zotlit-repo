import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  ignorePatterns: [...baseConfig.ignorePatterns],
  sortTailwindcss: {
    stylesheet: "./src/zt-main.css",
    functions: ["cn", "tv"],
  },
});
