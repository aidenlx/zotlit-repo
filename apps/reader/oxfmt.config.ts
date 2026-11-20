import { defineConfig } from "oxfmt";

import baseConfig from "@zotlit/config/oxfmt";

export default defineConfig({
  ...baseConfig,
  sortTailwindcss: {
    stylesheet: "./src/main.css",
    functions: ["cn", "tv"],
  },
});
