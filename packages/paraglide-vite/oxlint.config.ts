import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, { nodeAllowed } from "@zotlit/config/oxlint";

export default defineConfig({
  overrides: [
    nodeAllowed(["**/*"]),
    ...testBaselineOverrides("packages/paraglide-vite"),
  ],
  extends: [baseConfig],
});
