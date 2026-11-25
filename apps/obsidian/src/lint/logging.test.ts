import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { effectLoggingOnly } from "../../../../packages/config/oxlint-plugin-logging.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});

const filename = "/repo/packages/citations/src/obsidian/example.ts";
const kernelFile = "/repo/packages/plugin-kernel/src/example.ts";

tester.run("effect-logging-only", effectLoggingOnly, {
  valid: [
    {
      code: 'import { Effect } from "effect";\nimport { logServices, withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";\nEffect.runSyncWith(logServices)(Effect.logWarning("Lost").pipe(withLogCategory("views")));',
      filename,
    },
    {
      code: 'import { Console } from "effect";\nConsole.error("Could not apply the log settings");',
      filename,
    },
    {
      code: "console.info(...args);",
      filename: "/repo/packages/plugin-kernel/src/log-console.ts",
    },
    {
      code: 'console.error("ZotLit worker log port failed:", kind);',
      filename: "/repo/packages/plugin-kernel/src/worker/effect-log-port.ts",
    },
    {
      code: 'import { getLogger } from "./third-party-logger.ts";',
      filename,
    },
    {
      code: 'console.log("pandoc version");',
      filename:
        "/repo/packages/citations/src/core/pandoc/filter/zotlit-cite.pandoc.test.ts",
    },
  ],
  invalid: [
    {
      code: 'import { getLogger } from "@logtape/logtape";',
      filename,
      errors: [{ messageId: "logtape" }],
    },
    {
      code: 'import type { LogRecord } from "@logtape/logtape";',
      filename,
      errors: [{ messageId: "logtape" }],
    },
    {
      code: 'export { configure } from "@logtape/logtape";',
      filename,
      errors: [{ messageId: "logtape" }],
    },
    {
      code: 'const logtape = await import("@logtape/logtape");',
      filename,
      errors: [{ messageId: "logtape" }],
    },
    {
      code: 'import { getLogger } from "@zotlit/plugin-kernel/log.ts";',
      filename,
      errors: [{ messageId: "getLogger" }],
    },
    {
      code: 'import { getLogger } from "#log.ts";',
      filename: kernelFile,
      errors: [{ messageId: "getLogger" }],
    },
    {
      code: 'export { getLogger } from "./log.ts";',
      filename: kernelFile,
      errors: [{ messageId: "getLogger" }],
    },
    {
      code: 'console.log("opened");',
      filename,
      errors: [{ messageId: "console" }],
    },
    {
      code: 'console.error("ZotLit cleanup error:", error);',
      filename: "/repo/packages/plugin-shell/src/obsidian/plugin.ts",
      errors: [{ messageId: "console" }],
    },
  ],
});
