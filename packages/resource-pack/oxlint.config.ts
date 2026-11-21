import { defineConfig } from "oxlint";

import baseConfig, {
  engineBoundaryRules,
  engineNodeOnlyOverride,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  rules: engineBoundaryRules(),
  overrides: [engineNodeOnlyOverride()],
  plugins: ["node"],
});
