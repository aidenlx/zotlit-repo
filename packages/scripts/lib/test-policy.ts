import { regex } from "arkregex";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { $ } from "zx";

import { affectedBase } from "#affected-base";

const baselineFile = "packages/config/oxlint-tests-baseline.json";
const sourceFile = regex("\\.[cm]?[jt]sx?$");
const configFile = regex(
  "(?:^|/)(?:oxlint\\.config\\.[cm]?[jt]s|\\.oxlintrc\\.json)$",
);
const directive = regex(
  "^\\s*(?:oxlint|eslint)-disable(?:-next-line|-line)?\\b",
);
const rule = regex(
  "\\bzotlit-tests/(?:no-source-text|no-internal-mock|no-markup-assertion)\\b",
);
const fakeRule = regex("\\bzotlit-effect-tests/typed-fake\\b");
const disabledRule = regex(
  "['\"](zotlit-tests/(?:no-source-text|no-internal-mock|no-markup-assertion))['\"]\\s*\\]?\\s*:",
  "g",
);
const disabledFakeRule = regex(
  "['\"](zotlit-effect-tests/typed-fake)['\"]\\s*\\]?\\s*:",
  "g",
);
const environmentDirective = regex(
  "^\\s*\\*?\\s*@vitest-environment\\s+(\\S+)",
);
const testSource = regex("\\.test\\.[cm]?[jt]sx?$");
const disabledSeverity = regex(
  "^\\s*(?:\\[\\s*)?(?:['\"](?:off|allow)['\"]|0\\b)",
);

export type Baseline = Record<string, string[]>;

export interface VitestProject {
  config: string;
  name?: string;
  environment?: string;
}

export interface EnvironmentDirective {
  file: string;
  line: number;
  environment: string;
}

const domEnvironment = regex("happy-dom|jsdom");
const docsComponentTest = regex("^apps/docs/.*\\.test\\.tsx$");
const domBaselineRule = "test-policy/dom-environment";
const domWorkspaces = new Set([
  "apps/obsidian",
  "apps/reader",
  "packages/annotations",
  "packages/citations",
  "packages/library-view",
  "packages/notes",
  "packages/obsidian-kit",
  "packages/plugin-kernel",
  "packages/plugin-services",
  "packages/plugin-shell",
  "packages/query-views",
  "packages/template-workbench",
  "packages/ui",
]);
const domFix = `Prove UI behaviour with a pure function in a *.test.ts file plus the e2e journey or a browser check (policies/testing-strategy.md). DOM environments run only in ${[...domWorkspaces].join(", ")}.`;

function workspaceOf(file: string) {
  return file.split("/").slice(0, 2).join("/");
}

export interface DomTestTree {
  projects: VitestProject[];
  directives: EnvironmentDirective[];
  files: string[];
}

export function domTestErrors(
  { projects, directives, files }: DomTestTree,
  baseline: Baseline,
): string[] {
  const errors: string[] = [];
  const exempt = (file: string) =>
    domWorkspaces.has(workspaceOf(file)) ||
    baseline[file]?.includes(domBaselineRule);
  for (const { config, name, environment } of projects)
    if (environment && domEnvironment.test(environment) && !exempt(config))
      errors.push(
        `${config}: Vitest project ${name ?? "(default)"} runs in ${environment}. ${domFix}`,
      );
  for (const { file, line, environment } of directives)
    if (domEnvironment.test(environment) && !exempt(file))
      errors.push(`${file}:${line}: ${environment} environment. ${domFix}`);
  for (const file of files)
    if (docsComponentTest.test(file))
      errors.push(`${file}: docs component test. ${domFix}`);
  return errors;
}

const flatBaselineRules = [
  "zotlit-tests/no-internal-mock",
  "zotlit-tests/no-source-text",
];

function parseBaseline(source: string): Baseline {
  const parsed = JSON.parse(source) as Baseline | string[];
  return Array.isArray(parsed)
    ? Object.fromEntries(parsed.map((file) => [file, flatBaselineRules]))
    : parsed;
}

async function renamesSince(
  root: string,
  base: string,
): Promise<Map<string, string>> {
  const diff = await $({
    cwd: root,
    quiet: true,
    nothrow: true,
  })`git diff --name-status --find-renames --diff-filter=R ${base}`;
  const moved = new Map<string, string>();
  for (const line of diff.stdout.split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) moved.set(to, from);
  }
  return moved;
}

export async function checkTestPolicy(
  root: string,
  files: string[],
  projects: VitestProject[],
): Promise<string[]> {
  const errors: string[] = [];
  const baseline = parseBaseline(
    readFileSync(join(root, baselineFile), "utf8"),
  );
  const base = await affectedBase(root);
  const previous = base
    ? await $({
        cwd: root,
        quiet: true,
        nothrow: true,
      })`git show ${base}:${baselineFile}`
    : undefined;
  if (previous?.exitCode === 0) {
    const allowed = parseBaseline(previous.stdout);
    const movedFrom = await renamesSince(root, base!);
    const knownRules = new Set(Object.values(allowed).flat());
    const newRules = new Set<string>();
    for (const [file, rules] of Object.entries(baseline))
      for (const exempt of rules)
        if (!knownRules.has(exempt)) newRules.add(exempt);
        else if (
          !allowed[file]?.includes(exempt) &&
          !allowed[movedFrom.get(file) ?? ""]?.includes(exempt)
        )
          errors.push(
            `${baselineFile}: added baseline entry ${file} (${exempt})`,
          );
    for (const adopted of newRules)
      console.log(
        `check-test-gates: ${adopted} is new to the baseline; skipping its growth check.`,
      );
  } else {
    console.log(
      `check-test-gates: ${base ? "no baseline at the merge base" : "no merge base"}; skipping baseline growth check.`,
    );
  }
  for (const file of Object.keys(baseline))
    if (!existsSync(join(root, file)))
      errors.push(`${baselineFile}: missing file ${file}`);

  const tracked = new Set(
    execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    }).split("\0"),
  );
  const require = createRequire(import.meta.url);
  const configRequire = createRequire(require.resolve("@zotlit/config/oxlint"));
  const { parseSync } = (await import(
    pathToFileURL(configRequire.resolve("oxc-parser")).href
  )) as {
    parseSync: (
      file: string,
      source: string,
    ) => { comments: { value: string; start: number; end: number }[] };
  };
  const directives: EnvironmentDirective[] = [];
  for (const file of files) {
    const config = file !== "oxlint.config.ts" && configFile.test(file);
    const test = testSource.test(file);
    if (!config && !test && !(tracked.has(file) && sourceFile.test(file)))
      continue;
    const source = readFileSync(join(root, file), "utf8");
    const comments = parseSync(file, source).comments;
    if (test)
      for (const comment of comments) {
        const environment = environmentDirective.exec(comment.value)?.[1];
        if (environment)
          directives.push({
            file,
            line: source.slice(0, comment.start).split("\n").length,
            environment,
          });
      }
    if (tracked.has(file)) {
      for (const comment of comments) {
        const rules = comment.value.split("--")[0] ?? "";
        if (
          directive.test(rules) &&
          (rule.test(rules) || fakeRule.test(rules))
        ) {
          const line = source.slice(0, comment.start).split("\n").length;
          errors.push(`${file}:${line}: test-rule disable directive`);
        }
      }
    }
    if (config) {
      let code = source;
      for (const comment of comments.toReversed())
        code =
          code.slice(0, comment.start) +
          " ".repeat(comment.end - comment.start) +
          code.slice(comment.end);
      for (const match of [
        ...code.matchAll(disabledRule),
        ...code.matchAll(disabledFakeRule),
      ])
        if (disabledSeverity.test(code.slice(match.index + match[0].length)))
          errors.push(`${file}: ${match[1]} must stay enabled`);
    }
  }
  errors.push(...domTestErrors({ projects, directives, files }, baseline));
  return errors;
}
