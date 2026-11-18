import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noLogTapeInEffectFile } from "../../../../packages/config/oxlint-plugin-logging.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const filename = "/repo/apps/obsidian/src/services/example.ts";
const logtape = [{ messageId: "logtape" }];

tester.run("no-logtape-in-effect-file", noLogTapeInEffectFile, {
  valid: [
    {
      code: 'import { getLogger } from "@zotlit/plugin-kernel/log.ts";',
      filename,
    },
    {
      code: 'import { Effect } from "effect";',
      filename,
    },
    {
      code: 'import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";\nimport { getLogger } from "@zotlit/plugin-kernel/log.ts";',
      filename,
    },
  ],
  invalid: [
    {
      code: 'import { Effect } from "effect";\nimport { getLogger } from "@zotlit/plugin-kernel/log.ts";',
      filename,
      errors: logtape,
    },
    {
      code: 'import { Effect } from "effect";\nimport { getLogger } from "@logtape/logtape";',
      filename,
      errors: logtape,
    },
    {
      code: 'import { withLogCategory } from "#effect-log.ts";\nexport { getLogger } from "./log";',
      filename: "/repo/packages/plugin-kernel/src/example.ts",
      errors: logtape,
    },
    {
      code: 'import type { Effect } from "effect";\nimport { getLogger } from "@zotlit/plugin-kernel/log.ts";',
      filename,
      errors: logtape,
    },
    {
      code: 'import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";\nimport { getLogger } from "@zotlit/plugin-kernel/log.ts";',
      filename,
      errors: logtape,
    },
  ],
});
