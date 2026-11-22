import { defineConfig } from "oxlint";

import baseConfig, {
  datePattern,
  engineBoundaryRules,
  engineNodeOnlyOverride,
} from "@zotlit/config/oxlint";

export default defineConfig({
  extends: [baseConfig],
  plugins: ["node"],
  rules: engineBoundaryRules(),
  overrides: [
    engineNodeOnlyOverride(["src/client/node.ts"]),
    {
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
});
