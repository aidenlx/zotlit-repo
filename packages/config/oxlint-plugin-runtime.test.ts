import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { noNodeBuiltin } from "./oxlint-plugin-runtime.ts";

RuleTester.describe = (name, fn) => {
  void describe(name, fn);
};
RuleTester.it = (name, fn) => {
  void it(name, fn);
};
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const message = "Node is absent here.";
const options = [{ message }];
const builtin = (name: string) => ({
  messageId: "builtin",
  data: { name, message },
});

tester.run("no-node-builtin", noNodeBuiltin, {
  valid: [
    { code: 'import { m } from "@zotlit/shared/m.ts";', options },
    { code: 'import fflate from "fflate";', options },
    { code: 'import { path } from "./node:path.ts";', options },
    { code: "await import(specifier);", options },
  ],
  invalid: [
    {
      code: 'import { readFile } from "node:fs";',
      options,
      errors: [builtin("node:fs")],
    },
    { code: 'import path from "path";', options, errors: [builtin("path")] },
    {
      code: 'import type { Stats } from "node:fs";',
      options,
      errors: [builtin("node:fs")],
    },
    {
      code: 'export { join } from "node:path"; export * from "os";',
      options,
      errors: [builtin("node:path"), builtin("os")],
    },
    {
      code: 'await import("node:url"); require("zlib");',
      options,
      errors: [builtin("node:url"), builtin("zlib")],
    },
    {
      code: 'import { DatabaseSync } from "node:sqlite";',
      options,
      errors: [builtin("node:sqlite")],
    },
  ],
});
