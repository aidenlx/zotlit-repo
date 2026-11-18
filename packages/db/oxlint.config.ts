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
    // The Node adapter of the client, and the file path helpers that the
    // `./path` export serves to desktop hosts.
    engineNodeOnlyOverride(["src/client/node.ts", "src/lib/zt-path.ts"]),
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
