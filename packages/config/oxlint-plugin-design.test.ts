import { join } from "node:path";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import { annotationDesign } from "./oxlint-plugin-design.ts";

RuleTester.describe = (name, fn) => {
  void describe(name, fn);
};
RuleTester.it = (name, fn) => {
  void it(name, fn);
};
const tester = new RuleTester({
  languageOptions: { parserOptions: { lang: "tsx" } },
});
const design = [{ messageId: "design" }];
tester.run("annotation-view", annotationDesign, {
  valid: [
    '<div className="zt:ms-2 zt:text-xs zt:line-clamp-2 zt:leading-normal" aria-label="Open" />',
    '<><div className="zt:line-clamp-2" /><div className="zt:leading-tight" /></>',
    'el.setAttribute("aria-label", "Open")',
    {
      filename: join(import.meta.dirname, "__fixtures__/design/register.ts"),
      code: 'import "./valid.css"',
    },
  ],
  invalid: [
    '<div className="zt:hover:pl-2" />',
    '<div className="zt:text-right" />',
    '<div className="zt:text-[10px]" />',
    '<div className="zt:uppercase" />',
    "<div title={label} />",
    'el.setAttribute("title", label)',
    '<div className="zt:md:columns-2" />',
    '<div className="zt:transition-all" />',
    '<div className={cn("zt:line-clamp-3", active && "zt:leading-none")} />',
    '<div className="zt:line-clamp-2 zt:leading-tight" />',
    {
      filename: join(import.meta.dirname, "__fixtures__/design/register.ts"),
      code: 'import "./invalid.css"',
      errors: Array.from({ length: 8 }, () => ({ messageId: "design" })),
    },
  ].map((test) =>
    typeof test === "string" ? { code: test, errors: design } : test,
  ),
});
