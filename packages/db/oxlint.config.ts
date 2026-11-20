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
    // The Node adapter of the client.
    engineNodeOnlyOverride(["src/client/node.ts"]),
    {
      // Codegen scripts read `src/` directly; the `@/` alias resolves for the
      // bundler, not for `node scripts/*.ts`.
      files: ["scripts/**"],
      rules: {
        "no-restricted-imports": ["error", { patterns: [datePattern] }],
      },
    },
  ],
});
