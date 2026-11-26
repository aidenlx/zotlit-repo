import { defineConfig } from "oxlint";

import baseConfig, { nodeAllowed } from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  overrides: [nodeAllowed(["**/*"])],
});
