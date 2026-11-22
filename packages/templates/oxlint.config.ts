import { defineConfig } from "oxlint";

import {
  engineBoundaryRules,
  engineNodeOnlyOverride,
  testBaselineOverrides,
} from "@zotlit/config/oxlint";
import baseConfig from "@zotlit/config/oxlint";

export default defineConfig({
  rules: engineBoundaryRules(),
  overrides: [
    engineNodeOnlyOverride(),
    ...testBaselineOverrides("packages/templates"),
    {
      files: ["src/liquid-date.ts", "src/coerce.ts", "src/coerce.test.ts"],
      rules: {
        "effecttsgo/global-date": "off",
        "no-restricted-globals": "off",
        "typescript/no-restricted-types": "off",
      },
    },
  ],
  extends: [baseConfig],
});
