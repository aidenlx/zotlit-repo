import { Effect } from "effect";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CITATION_FRAGMENT_FIXTURES } from "@zotlit/plugin-kernel/__fixtures__/citation-fragments.ts";

import { runFileEffect } from "#__fixtures__/pandoc/file-effects.ts";
import {
  materializeCslStyle,
  resolveCslStyle as resolveStyleEffect,
  resolveDocumentCslStyle as resolveDocumentEffect,
} from "#desktop/pandoc/csl.ts";
import { resolveInstalledStyle } from "#desktop/pandoc/styles.ts";
const resolveCslStyle = (...args: Parameters<typeof resolveStyleEffect>) =>
  runFileEffect(resolveStyleEffect(...args));
const resolveDocumentCslStyle = (
  ...args: Parameters<typeof resolveDocumentEffect>
) => runFileEffect(resolveDocumentEffect(...args));

import {
  PANDOC_DEFAULTS_FILENAME,
  PANDOC_FILTER_FILENAME,
  PANDOC_RESOLVE_MAP_FILENAME,
  pandocCliFilter,
  pandocDefaults,
  pandocSandboxFilter,
} from "./index.ts";

const pandocBin = process.env.PANDOC_BIN ?? "pandoc";
const noPandoc =
  process.env.PANDOC_BIN === undefined &&
  spawnSync(pandocBin, ["--version"]).error !== undefined;

const workspaceRoot = join(
  import.meta.dirname,
  "../../../../.scratch/lua-filter",
);

const REFERENCES = [
  {
    id: "doe2020",
    type: "book",
    title: "A Book",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020]] },
  },
  {
    id: "smith2021",
    type: "book",
    title: "Another Book",
    author: [{ family: "Smith", given: "Ann" }],
    issued: { "date-parts": [[2021]] },
  },
  {
    id: "voilà2022",
    type: "book",
    title: "A Third Book",
    author: [{ family: "Roe", given: "Alex" }],
    issued: { "date-parts": [[2022]] },
  },
];

const RESOLVE_MAP = {
  citations: {
    "Doe 2020": "doe2020",
    "Doe 2020.md": "doe2020",
    "Smith 2021": "smith2021",
  },
};

const CSL_REFERENCES = [
  {
    id: "doe2020",
    type: "book",
    title: "A Book",
    author: [{ family: "Doe", given: "Jane" }],
    issued: { "date-parts": [[2020, 3]] },
  },
];

const CSL_PARENT = "http://www.zotero.org/styles/journal";
const CSL_DEPENDENT = "http://www.zotero.org/styles/journal-german";
const CSL_MISSING = "http://www.zotero.org/styles/uninstalled";

const CSL_PARENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Journal</title>
    <id>${CSL_PARENT}</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text variable="citation-number" prefix="[" suffix="]"/></layout></citation>
  <bibliography>
    <layout>
      <text value="journal"/>
      <date variable="issued" prefix=" ">
        <date-part name="month" form="long"/>
      </date>
    </layout>
  </bibliography>
</style>`;

const CSL_DEPENDENT_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0" default-locale="de-DE">
  <info>
    <title>Journal (German)</title>
    <id>${CSL_DEPENDENT}</id>
    <link href="${CSL_PARENT}" rel="independent-parent"/>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
</style>`;

const PANDOC_OWNED_STYLE = `<?xml version="1.0" encoding="utf-8"?>
<style xmlns="http://purl.org/net/xbiblio/csl" class="in-text" version="1.0">
  <info>
    <title>Pandoc owned</title>
    <id>http://example.com/styles/pandoc-owned</id>
    <updated>2020-01-01T00:00:00+00:00</updated>
  </info>
  <citation><layout><text value="pandoc-owned-citation"/></layout></citation>
  <bibliography><layout><text value="pandoc-owned-entry"/></layout></bibliography>
</style>`;

const ERROR_MAP = {
  errors: [
    {
      code: "item-not-found",
      linkpath: "Doe 2020",
      message: 'No live Item matches Indexed Key "ABC12345".',
    },
  ],
};

type Expectation =
  | { plain: string }
  | { absent: string[] }
  | { native: string[] }
  | { error: string };

type Case = { name: string; markdown: string } & Expectation;

const CASES: Case[] = [
  { name: "plain wikilink", markdown: "[[Doe 2020]]", plain: "(Doe 2020)" },
  {
    name: "markdown link",
    markdown: "[Doe](Doe%202020.md)",
    plain: "(Doe 2020)",
  },
  { name: "alias", markdown: "[[Doe 2020|Jane's book]]", plain: "(Doe 2020)" },
  {
    name: "citation run",
    markdown: "[[Doe 2020]]; [[Smith 2021]]",
    plain: "(Doe 2020; Smith 2021)",
  },
  {
    name: "citation run without spaces",
    markdown: "[[Doe 2020]];[[Smith 2021]]",
    plain: "(Doe 2020; Smith 2021)",
  },
  {
    name: "citation run leading with author-in-text",
    markdown:
      "see [[Doe 2020#cite:mode=author-in-text&locator=33]]; [[Smith 2021]]",
    plain: "see Doe (2020, 33; Smith 2021)",
  },
  {
    name: "comma is not a citation run",
    markdown: "[[Doe 2020]], [[Smith 2021]]",
    plain: "(Doe 2020), (Smith 2021)",
  },
  {
    name: "a line break ends a citation run",
    markdown: "[[Doe 2020]];\n[[Smith 2021]]",
    plain: "(Doe 2020); (Smith 2021)",
  },
  {
    name: "the same note twice with distinct details",
    markdown:
      "[[Doe 2020#cite:locator=33]]; [[Doe 2020#cite:prefix=compare&locator=40]]",
    plain: "(Doe 2020, 33; compare Doe 2020, 40)",
  },
  {
    name: "citation inside a blockquote",
    markdown: "> quoted [[Doe 2020]]",
    plain: "(Doe 2020)",
  },
  {
    name: "citation inside a list item",
    markdown: "- item [[Doe 2020]]",
    plain: "(Doe 2020)",
  },
  {
    name: "citation inside a heading",
    markdown: "## Background [[Doe 2020]]",
    plain: "Background (Doe 2020)",
  },
  {
    name: "citation run inside emphasis",
    markdown: "*[[Doe 2020]]; [[Smith 2021]]*",
    plain: "(Doe 2020; Smith 2021)",
  },
  {
    name: "citation inside a table cell",
    markdown: "| head |\n| --- |\n| [[Doe 2020]] |",
    plain: "(Doe 2020)",
  },
  {
    name: "an ordinary link stays a link",
    markdown: "[[Some Note]]",
    native: ["Link", '"Some Note"'],
  },
  {
    name: "a callout under a paragraph becomes a block quote under its bold title",
    markdown: "Text [[Doe 2020]].\n> [!note]- Page 1\n>\n> Quote.",
    native: ["BlockQuote", 'Para [ Strong [ Str "Page" , Space , Str "1" ] ]'],
  },
  {
    name: "a callout marker never reaches the output",
    markdown: "Text [[Doe 2020]].\n> [!quote]\n> Quote.",
    absent: ["[!quote]"],
  },
  {
    name: "a heading fragment still cites the Literature Note",
    markdown: "[[Doe 2020#Summary]]",
    plain: "(Doe 2020)",
  },
  {
    name: "an embed never becomes a citation",
    markdown: "![[Doe 2020]]",
    absent: ["(Doe 2020)"],
  },
  {
    name: "an ordinary link breaks a citation run",
    markdown: "[[Doe 2020]]; [[Some Note]]; [[Smith 2021]]",
    plain: "(Doe 2020); Some Note; (Smith 2021)",
  },
  {
    name: "a Literature Note link in a citation suffix keeps the outer citation",
    markdown: "[@doe2020 with [[Smith 2021]]]",
    plain: "(Doe 2020 with Smith 2021)",
  },
  {
    name: "a Literature Note link in a citation suffix reaches the bibliography",
    markdown: "[@doe2020 with [[Smith 2021]]]",
    plain: "Smith, Ann. 2021. Another Book.",
  },
  {
    name: "a nested Literature Note link shows its alias",
    markdown: "[@doe2020 with [[Smith 2021|the other book]]]",
    plain: "(Doe 2020 with the other book)",
  },
  {
    name: "a Literature Note link in a citation prefix keeps the outer citation",
    markdown: "[after [[Smith 2021]] see @doe2020]",
    plain: "(after Smith 2021 see Doe 2020)",
  },
  {
    name: "a literal citation in a citation suffix keeps the outer citation",
    markdown: "[@doe2020 with @smith2021]",
    plain: "(Doe 2020 with @smith2021)",
  },
  {
    name: "a literal citation in a citation suffix reaches the bibliography",
    markdown: "[@doe2020 with @smith2021]",
    plain: "Smith, Ann. 2021. Another Book.",
  },
  {
    name: "a literal citation with a non-ASCII key in a citation suffix keeps its key",
    markdown: "[@doe2020 with @voilà2022]",
    plain: "(Doe 2020 with @voilà2022)",
  },
  {
    name: "a cite intent inside a citation suffix",
    markdown: "[@doe2020 with [[Smith 2021#cite:locator=3]]]",
    error: "nested-citation-intent",
  },
  {
    name: "author-in-text after the first run position",
    markdown: "[[Doe 2020]]; [[Smith 2021#cite:mode=author-in-text]]",
    error: "only the first position in a Citation Run",
  },
  {
    name: "cite intent on a note that is not a Literature Note",
    markdown: "[[Some Note#cite:locator=3]]",
    error: "unresolved-citation-intent",
  },
  {
    name: "a bad fragment inside a heading stops the run",
    markdown: "## Background [[Doe 2020#cite:page=1]]",
    error: '"page" is not a Citation Fragment parameter',
  },
  {
    name: "every error in one run",
    markdown: "[[Doe 2020#cite:locator=]] and [[Doe 2020#cite:page=1]]",
    error: "stopped on 2 error(s)",
  },
  {
    name: "a link that breaks a citation run reports one error",
    markdown: "[[Doe 2020]]; [[Doe 2020#cite:page=1]]",
    error: "stopped on 1 error(s)",
  },
];

for (const fixture of CITATION_FRAGMENT_FIXTURES) {
  if (fixture.fragment === null) continue;
  const markdown = `[[Doe 2020#cite:${fixture.fragment}]]`;
  CASES.push(
    fixture.error
      ? { name: fixture.name, markdown, error: fixture.error }
      : { name: fixture.name, markdown, plain: fixture.plain! },
  );
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function pandoc(
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Run {
  const result = spawnSync(pandocBin, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function flatten(text: string): string {
  return text.replaceAll(/\s+/g, " ");
}

function expectRan(run: Run, output: string, ...expected: string[]): void {
  expect(run.status, run.stderr).toBe(0);
  for (const wanted of expected) expect(output).toContain(wanted);
}

function expectStopped(run: Run, ...expected: string[]): void {
  expect(run.status, run.stdout).not.toBe(0);
  for (const wanted of expected) expect(run.stderr).toContain(wanted);
}

function writeMap(directory: string, payload: unknown): Promise<void> {
  return writeFile(
    join(directory, PANDOC_RESOLVE_MAP_FILENAME),
    JSON.stringify(payload),
  );
}

describe.skipIf(noPandoc)("zotlit-cite.lua under native Pandoc", () => {
  let workspace: string;
  let failed = false;

  beforeAll(async () => {
    const version = pandoc(["--version"], { cwd: import.meta.dirname });
    if (version.status !== 0) {
      throw new Error(
        `Could not run "${pandocBin}". Install Pandoc 3.1.1 or newer, or set PANDOC_BIN.`,
      );
    }
    console.log(version.stdout.split("\n")[0]);

    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(workspaceRoot, { recursive: true });
    workspace = await realpath(workspaceRoot);

    await writeFile(
      join(workspace, "references.json"),
      JSON.stringify(REFERENCES),
    );
    await writeMap(workspace, RESOLVE_MAP);
    await writeFile(join(workspace, PANDOC_DEFAULTS_FILENAME), pandocDefaults);
    await writeFile(
      join(workspace, PANDOC_FILTER_FILENAME),
      pandocSandboxFilter,
    );
  });

  afterEach(({ task }) => {
    if (task.result?.state === "fail") failed = true;
  });

  afterAll(async () => {
    if (failed) console.error(`fixtures kept at ${workspace}`);
    else if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  function convert(input = "input.md"): Run {
    return pandoc(
      [
        input,
        "--defaults",
        join(workspace, PANDOC_DEFAULTS_FILENAME),
        "--bibliography",
        "references.json",
        "--to",
        "plain",
      ],
      { cwd: workspace },
    );
  }

  describe("sandbox variant", () => {
    it.each(CASES)("$name", async (testCase) => {
      await writeFile(join(workspace, "input.md"), `${testCase.markdown}\n`);

      if ("native" in testCase) {
        const run = pandoc(
          [
            "input.md",
            "--from",
            "markdown+wikilinks_title_after_pipe-blank_before_blockquote",
            "--lua-filter",
            join(workspace, PANDOC_FILTER_FILENAME),
            "--to",
            "native",
          ],
          { cwd: workspace },
        );
        expectRan(run, flatten(run.stdout), ...testCase.native);
        return;
      }

      const run = convert();
      if ("error" in testCase) {
        expectStopped(run, testCase.error);
        return;
      }
      const output = flatten(run.stdout);
      if ("plain" in testCase) {
        expectRan(run, output, testCase.plain);
        return;
      }
      expectRan(run, output);
      for (const text of testCase.absent) expect(output).not.toContain(text);
    });

    it("an empty errors array converts as usual", async () => {
      await writeFile(join(workspace, "input.md"), "[[Doe 2020]]\n");
      await writeMap(workspace, { ...RESOLVE_MAP, errors: [] });
      const run = convert();
      await writeMap(workspace, RESOLVE_MAP);

      expectRan(run, flatten(run.stdout), "(Doe 2020)");
    });

    it("resolve map errors abort the run", async () => {
      await writeFile(join(workspace, "input.md"), "[[Doe 2020]]\n");
      await writeMap(workspace, ERROR_MAP);
      const run = convert();
      await writeMap(workspace, RESOLVE_MAP);

      expectStopped(run, "[item-not-found]");
    });
  });

  interface Cli {
    workspace: string;
    notes: string;
    response: string;
    cslResponse: string;
    cslFileResponse: string;
    callLog: string;
    dataDir: string;
    store: string;
    env: NodeJS.ProcessEnv;
  }

  async function setupCli(workspace: string): Promise<Cli> {
    const notes = join(workspace, "notes");
    const bin = join(workspace, "bin");
    const callLog = join(workspace, "obsidian-call.txt");
    const response = join(workspace, "obsidian-response.json");
    const cslResponse = join(workspace, "obsidian-csl-response.json");
    const cslFileResponse = join(workspace, "obsidian-csl-file-response.json");
    const dataDir = join(workspace, "zotero");
    const styles = join(dataDir, "styles");
    await mkdir(notes, { recursive: true });
    await mkdir(bin, { recursive: true });
    await mkdir(join(styles, "hidden"), { recursive: true });

    const stub = join(bin, "obsidian");
    await writeFile(
      stub,
      [
        "#!/bin/sh",
        `printf '%s|%s\\n' "$PWD" "$*" >> "${callLog}"`,
        'case "$1 $2" in',
        `"zotlit:csl file="*) exec cat "${cslFileResponse}" ;;`,
        `zotlit:csl*) exec cat "${cslResponse}" ;;`,
        `*) exec cat "${response}" ;;`,
        "esac",
        "",
      ].join("\n"),
    );
    await chmod(stub, 0o755);

    await writeFile(join(notes, "input.md"), "[[Doe 2020#cite:locator=33]]\n");
    await writeFile(join(notes, PANDOC_FILTER_FILENAME), pandocCliFilter);
    await writeFile(join(notes, PANDOC_DEFAULTS_FILENAME), pandocDefaults);

    await writeFile(join(styles, "hidden", "journal.csl"), CSL_PARENT_STYLE);
    await writeFile(join(styles, "journal-german.csl"), CSL_DEPENDENT_STYLE);
    await writeFile(
      join(workspace, "csl-references.json"),
      JSON.stringify(CSL_REFERENCES),
    );
    await writeFile(join(workspace, "pandoc-owned.csl"), PANDOC_OWNED_STYLE);
    await writeFile(
      cslFileResponse,
      JSON.stringify(
        await resolveDocumentCslStyle(join(notes, "input.md"), {
          resolve: () => Effect.die(new Error("Default resolves nothing")),
          readStyle: () =>
            Effect.succeed({
              kind: "read",
              styleId: null,
              source: { kind: "vault" },
            }),
        }),
      ),
    );

    return {
      workspace,
      notes,
      response,
      cslResponse,
      cslFileResponse,
      callLog,
      dataDir,
      store: join(workspace, "csl-store"),
      env: { PATH: `${bin}:${process.env.PATH ?? ""}` },
    };
  }

  async function runCli(
    cli: Cli,
    {
      bibliography = "references.json",
      to = "plain",
      standalone = false,
      csl,
      failIfWarnings = false,
    }: {
      bibliography?: string;
      to?: string;
      standalone?: boolean;
      failIfWarnings?: boolean;
      csl?: string;
    } = {},
  ): Promise<Run> {
    await rm(cli.callLog, { force: true });
    return pandoc(
      [
        "notes/input.md",
        "--defaults",
        join(cli.notes, PANDOC_DEFAULTS_FILENAME),
        "--bibliography",
        bibliography,
        "--to",
        to,
        ...(standalone ? ["--standalone"] : []),
        ...(csl === undefined ? [] : ["--csl", csl]),
        ...(failIfWarnings ? ["--fail-if-warnings"] : []),
      ],
      { cwd: cli.workspace, env: cli.env },
    );
  }

  async function installCslResponse(cli: Cli, styleId: string): Promise<void> {
    const response = await resolveCslStyle(styleId, {
      resolve: (requested) =>
        resolveInstalledStyle(cli.dataDir, { styleId: requested }),
      materialize: (xml) => materializeCslStyle(xml, cli.store),
    });
    await writeFile(cli.cslResponse, JSON.stringify(response));
  }

  async function writeStyledInput(
    cli: Cli,
    properties: readonly string[],
  ): Promise<void> {
    await writeFile(
      join(cli.notes, "input.md"),
      ["---", ...properties, "---", "", "[[Doe 2020]]", ""].join("\n"),
    );
    await writeFile(cli.response, JSON.stringify(RESOLVE_MAP));
  }

  describe("cli variant", () => {
    let cli: Cli;
    beforeAll(async () => {
      cli = await setupCli(workspace);
    });

    it("calls zotlit:resolve", async () => {
      await writeFile(cli.response, JSON.stringify(RESOLVE_MAP));

      const run = await runCli(cli);
      expectRan(run, flatten(run.stdout), "(Doe 2020, 33)");
      const call = await readFile(cli.callLog, "utf8");
      expect(call).toContain(
        `zotlit:resolve file=${join(cli.notes, "input.md")}`,
      );
      expect(call).toContain(`${cli.notes}|`);
      expect(run.stderr).toContain(
        "ZotLit: citations use the Pandoc default style, Chicago author-date (from your vault settings).",
      );
    });

    it("aborts on an error payload", async () => {
      await writeFile(cli.response, JSON.stringify(ERROR_MAP));

      expectStopped(await runCli(cli), "[item-not-found]");
    });

    it("renders a dependent zotlit-csl style through its parent", async () => {
      await writeStyledInput(cli, [`zotlit-csl: ${CSL_DEPENDENT}`]);
      await installCslResponse(cli, CSL_DEPENDENT);

      const run = await runCli(cli, { bibliography: "csl-references.json" });
      expectRan(run, flatten(run.stdout), "[1]", "journal März");
      expect(await readFile(cli.callLog, "utf8")).toContain(
        `zotlit:csl style=${CSL_DEPENDENT}`,
      );
      expect(run.stderr).toContain(
        "ZotLit: citations use Journal (German) (from this note).",
      );
    });

    it("cites a note without its own style with the vault style", async () => {
      await writeStyledInput(cli, ["title: Draft"]);
      const input = join(cli.notes, "input.md");
      const defaultResponse = await readFile(cli.cslFileResponse, "utf8");
      await writeFile(
        cli.cslFileResponse,
        JSON.stringify(
          await resolveDocumentCslStyle(input, {
            resolve: (requested) =>
              resolveInstalledStyle(cli.dataDir, { styleId: requested }),
            materialize: (xml) => materializeCslStyle(xml, cli.store),
            readStyle: () =>
              Effect.succeed({
                kind: "read",
                styleId: CSL_DEPENDENT,
                source: { kind: "vault" },
              }),
          }),
        ),
      );

      const run = await runCli(cli, {
        bibliography: "csl-references.json",
        failIfWarnings: true,
      });
      await writeFile(cli.cslFileResponse, defaultResponse);
      expectRan(run, flatten(run.stdout), "[1]", "journal März");
      expect(await readFile(cli.callLog, "utf8")).toContain(
        `zotlit:csl file=${input}`,
      );
      expect(run.stderr).toContain(
        "ZotLit: citations use Journal (German) (from your vault settings).",
      );
    });

    it("preserves document lang", async () => {
      await writeStyledInput(cli, [
        `zotlit-csl: ${CSL_DEPENDENT}`,
        "lang: en-GB",
      ]);
      await installCslResponse(cli, CSL_DEPENDENT);

      const run = await runCli(cli, {
        bibliography: "csl-references.json",
        to: "markdown-citations",
        standalone: true,
      });
      expectRan(run, run.stdout, "lang: en-GB");
      expect(flatten(run.stdout)).toContain("journal March");
      expect(run.stdout).not.toContain("zotlit-csl:");
    });

    it("leaves a sole csl property to Pandoc", async () => {
      const owned = join(cli.workspace, "pandoc-owned.csl");
      await writeStyledInput(cli, [`csl: ${owned}`]);
      await rm(cli.cslResponse, { force: true });

      const run = await runCli(cli, { bibliography: "csl-references.json" });
      expectRan(run, flatten(run.stdout), "pandoc-owned-citation");
      expect(await readFile(cli.callLog, "utf8")).not.toContain("zotlit:csl");
      expect(run.stderr).toContain(
        `ZotLit: citations use the style file ${owned} (from the csl field or the --csl option).`,
      );
    });

    it("stops on csl and zotlit-csl together", async () => {
      await writeStyledInput(cli, [
        `csl: ${join(cli.workspace, "pandoc-owned.csl")}`,
        `zotlit-csl: ${CSL_DEPENDENT}`,
      ]);
      await installCslResponse(cli, CSL_DEPENDENT);

      const run = await runCli(cli, { bibliography: "csl-references.json" });
      expectStopped(run, "[csl-ambiguous]", '"csl"', '"zotlit-csl"');
    });

    it("stops on citation-style and zotlit-csl together", async () => {
      await writeStyledInput(cli, [
        `citation-style: ${join(cli.workspace, "pandoc-owned.csl")}`,
        `zotlit-csl: ${CSL_DEPENDENT}`,
      ]);
      await installCslResponse(cli, CSL_DEPENDENT);

      const run = await runCli(cli, { bibliography: "csl-references.json" });
      expectStopped(run, "[csl-ambiguous]", '"citation-style"', '"zotlit-csl"');
    });

    it("stops on a --csl option and zotlit-csl together", async () => {
      await writeStyledInput(cli, [`zotlit-csl: ${CSL_DEPENDENT}`]);
      await installCslResponse(cli, CSL_DEPENDENT);

      const run = await runCli(cli, {
        bibliography: "csl-references.json",
        csl: join(cli.workspace, "pandoc-owned.csl"),
      });
      expectStopped(run, "[csl-ambiguous]");
    });

    it("stops on an uninstalled zotlit-csl style", async () => {
      await writeStyledInput(cli, [`zotlit-csl: ${CSL_MISSING}`]);
      await installCslResponse(cli, CSL_MISSING);

      const run = await runCli(cli, { bibliography: "csl-references.json" });
      expectStopped(run, "[style-missing]", CSL_MISSING);
    });

    it("aborts when the resolve call fails", async () => {
      await writeFile(
        join(cli.notes, "input.md"),
        "[[Doe 2020#cite:locator=33]]\n",
      );
      await rm(cli.response, { force: true });

      expectStopped(await runCli(cli), "[resolve-call-failed]");
    });

    it("reads the opening Properties and keeps body separators", async () => {
      await writeFile(
        join(cli.notes, "input.md"),
        [
          "---",
          "title: Draft",
          "---",
          "",
          "% Not a title",
          "",
          "Before.",
          "",
          "---",
          "*Aside*",
          "---",
          "",
          "---",
          "lang: fr",
          "---",
          "",
          "After [[Doe 2020]].",
          "",
        ].join("\n"),
      );
      await writeFile(cli.response, JSON.stringify(RESOLVE_MAP));

      const run = await runCli(cli, { to: "html", standalone: true });
      expectRan(
        run,
        flatten(run.stdout),
        "<title>Draft</title>",
        "% Not a title",
        "<hr",
        "<em>Aside</em>",
        "lang: fr",
        "(Doe 2020",
      );
      expect(run.stdout).not.toContain('lang="fr"');
    });
  });
});
