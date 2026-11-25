import { defineConfig } from "oxlint";

import { testBaselineOverrides } from "@zotlit/config/oxlint";
import baseConfig, { nodeGlobals } from "@zotlit/config/oxlint";

export default defineConfig({
  overrides: [
    ...testBaselineOverrides("packages/templates"),
    {
      files: ["src/liquid-date.ts", "src/coerce.ts", "src/coerce.test.ts"],
      rules: {
        "effecttsgo/global-date": "off",
        "no-restricted-globals": ["error", nodeGlobals],
        "typescript/no-restricted-types": "off",
      },
    },
  ],
  extends: [baseConfig],
});
