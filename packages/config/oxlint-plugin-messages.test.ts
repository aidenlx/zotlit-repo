import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { noComputedMessage } from "./oxlint-plugin-messages.ts";

RuleTester.describe = (name, fn) => {
  void describe(name, fn);
};
RuleTester.it = (name, fn) => {
  void it(name, fn);
};
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "ts" } },
});
const plugin = 'import * as m from "@zotlit/plugin-messages/messages.ts";\n';

tester.run("no-computed-message", noComputedMessage, {
  valid: [
    `${plugin}m.welcome_view_name();`,
    `${plugin}m["zotero.prefs_notify_url"]();`,
    `${plugin}m[\`zotero.prefs_notify_section\`]();`,
    `${plugin}m["zotero.prefs_notify_url" as const]();`,
    `${plugin}m[("welcome_view_name" satisfies string)]();`,
    `${plugin}const LABELS = { a: m.a, b: m.b }; LABELS[key]();`,
    `${plugin}for (const m of text.matchAll(re)) out.push(m[1]);`,
    `${plugin}function f(m: string[]) { return m[index]; }`,
    'import * as m from "./math.ts";\nm[name]();',
    'import { m } from "@zotlit/plugin-messages/messages.ts";\nm[key];',
  ],
  invalid: [
    {
      code: `${plugin}m[key]();`,
      errors: [{ messageId: "computed", data: { name: "m" } }],
    },
    {
      code: `${plugin}const label = m[\`settings_\${id}_name\`];`,
      errors: [{ messageId: "computed" }],
    },
    {
      code: 'import * as shared from "@zotlit/plugin-messages/messages.ts";\nfunction label(key: string) { return shared[key as "a"](); }',
      errors: [{ messageId: "computed", data: { name: "shared" } }],
    },
    {
      code: `${plugin}(m as Record<string, () => string>)[key]!();`,
      errors: [{ messageId: "computed", data: { name: "m" } }],
    },
    {
      code: 'import * as m from "@zotlit/reader-messages/messages.ts";\nm[failure.key]();',
      errors: [{ messageId: "computed" }],
    },
    {
      code: 'import * as m from "@/paraglide/messages.js";\nm[key]();',
      errors: [{ messageId: "computed" }],
    },
  ],
});
