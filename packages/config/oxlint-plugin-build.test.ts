import { join } from "node:path";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { appPathRule, undeclaredEnvRule } from "./oxlint-plugin-build.ts";

RuleTester.describe = (name, fn) => {
  void describe(name, fn);
};
RuleTester.it = (name, fn) => {
  void it(name, fn);
};
const filename = join(import.meta.dirname, "__fixtures__/build/config.ts");
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
tester.run(
  "no-undeclared-env",
  undeclaredEnvRule({
    files: new Set([filename]),
    tasks: { "build:dev": ["DECLARED", "DEV_*"], dev: ["DECLARED"] },
  }),
  {
    valid: [
      { filename, code: "process.env.DECLARED" },
      { filename, code: 'const NAME = "DECLARED"; process.env[NAME]' },
      { filename, code: 'const define = { "process.env.MISSING": "value" }' },
      { filename, code: "process.env.GITHUB_TOKEN; process.env.GH_TOKEN" },
      { filename, code: 'process.env.MISSING = "value"' },
      { filename: "/runtime/module.ts", code: "process.env.MISSING" },
    ],
    invalid: [
      {
        filename,
        code: 'import { ENV_KEY as KEY } from "./keys.ts"; process.env[KEY]',
        errors: [
          {
            messageId: "undeclared",
            data: { name: "IMPORTED", tasks: "build:dev and dev" },
          },
        ],
      },
      {
        filename,
        code: 'const KEY = "MISSING" as const; process.env[KEY]',
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: "process.env[`MISSING`]",
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: "process.env.MISSING",
        errors: [
          {
            messageId: "undeclared",
            data: { name: "MISSING", tasks: "build:dev and dev" },
          },
        ],
      },
      {
        filename,
        code: 'process.env["MISSING"]',
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: 'const NAME = "MISSING"; process.env[NAME]',
        errors: [{ messageId: "undeclared" }],
      },
      {
        filename,
        code: "process.env.DEV_PORT",
        errors: [
          { messageId: "undeclared", data: { name: "DEV_PORT", tasks: "dev" } },
        ],
      },
    ],
  },
);

const workspace = join(import.meta.dirname, "__fixtures__/build/workspace");
const packageFile = join(workspace, "packages/kit/src/module.ts");
tester.run("no-app-path", appPathRule({ root: workspace }), {
  valid: [
    { filename: packageFile, code: 'import "./own.css";' },
    {
      filename: packageFile,
      code: 'import { theme } from "@zotlit/kit/theme.ts";',
    },
    {
      filename: join(workspace, "apps/host/src/main.ts"),
      code: 'import "../../../packages/kit/src/host.css";',
    },
  ],
  invalid: [
    {
      filename: packageFile,
      code: 'import { main } from "../../../apps/host/src/main.ts";',
      errors: [{ messageId: "module" }],
    },
    {
      filename: packageFile,
      code: 'export * from "../../../apps/host/src/main.ts";',
      errors: [{ messageId: "module" }],
    },
    {
      filename: packageFile,
      code: 'await import("../../../apps/host/src/main.ts");',
      errors: [{ messageId: "module" }],
    },
    {
      filename: packageFile,
      code: 'import "./host.css";',
      errors: [{ messageId: "stylesheet" }],
    },
  ],
});
