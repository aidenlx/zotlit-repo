export interface GeneratedArtifact {
  readonly task: string;
  readonly paths: readonly string[];
}

export const GENERATED_ARTIFACTS: readonly (readonly GeneratedArtifact[])[] = [
  [
    {
      task: "@zotlit/zotero-types#generate:fields",
      paths: ["packages/zotero-types/src/fields.ts"],
    },
    {
      task: "@zotlit/zotero-types#generate:item-types",
      paths: ["packages/zotero-types/src/item-types.ts"],
    },
    {
      task: "@zotlit/zotero-types#generate:field-labels",
      paths: ["packages/zotero-types/src/field-labels.ts"],
    },
    {
      task: "@zotlit/zotero-types#generate:csl",
      paths: ["packages/zotero-types/src/csl.ts"],
    },
    {
      task: "@zotlit/zotero-types#generate:vocabulary",
      paths: ["packages/zotero-types/src/vocabulary.ts"],
    },
  ],
  [
    {
      task: "@zotlit/db#generate:contract",
      paths: ["packages/db/src/contract/generated"],
    },
    {
      task: "@zotlit/docs#generate:template-data",
      paths: [
        "apps/docs/content/docs/reference/templates/data.mdx",
        "apps/docs/src/lib/template-contract/generated/page-model.json",
      ],
    },
    {
      task: "@zotlit/docs#generate:query-functions",
      paths: ["apps/docs/content/docs/reference/functions-and-methods.mdx"],
    },
    {
      task: "@zotlit/zotero-compat#generate:client-data",
      paths: [
        "packages/zotero-compat/src/isbn-ranges.ts",
        "packages/zotero-compat/src/date-formats.ts",
      ],
    },
    {
      task: "@zotlit/zotero-compat#generate:known-differences",
      paths: ["packages/zotero-compat/AGENTS.md"],
    },
    {
      task: "@zotlit/db#generate:replica-layout",
      paths: ["packages/db/src/replica/layout.generated.ts"],
    },
    {
      task: "@zotlit/filter-expression#generate:parser",
      paths: ["packages/filter-expression/src/generated"],
    },
    {
      task: "@zotlit/template-workbench#generate:eta",
      paths: [
        "packages/template-workbench/src/core/language/eta-parser.ts",
        "packages/template-workbench/src/core/language/eta-parser.terms.ts",
      ],
    },
    {
      task: "@zotlit/zotero-reads#generate:machine-table",
      paths: ["packages/zotero-reads/src/worker/web-api-machine.table.md"],
    },
  ],
];

export interface GeneratedRun {
  readonly regenerate: (tasks: readonly string[]) => Promise<unknown>;
  readonly status: (paths: readonly string[]) => Promise<string>;
}

const covers = (path: string, changed: string) =>
  changed === path || changed.startsWith(`${path}/`);

export async function checkGenerated(
  changed: readonly string[] | "all",
  { regenerate, status }: GeneratedRun,
): Promise<void> {
  const stages = GENERATED_ARTIFACTS.map((stage) =>
    changed === "all"
      ? stage
      : stage.filter((artifact) =>
          artifact.paths.some((path) =>
            changed.some((file) => covers(path, file)),
          ),
        ),
  ).filter((stage) => stage.length > 0);
  if (stages.length === 0) return;
  for (const stage of stages)
    await regenerate(stage.map((artifact) => artifact.task));
  const stale = (
    await status(stages.flat().flatMap((artifact) => artifact.paths))
  ).trim();
  if (stale) {
    throw new Error(
      `Regenerated output differs from the commit. Commit these files:\n${stale}`,
    );
  }
}

export const UNGATED_GENERATORS: Readonly<Record<string, string>> = {
  "@zotlit/docs#generate:messages":
    "writes src/paraglide, which git ignores; the docs tasks build it",
  "@zotlit/item-query#generate:schema":
    "writes generated/query.schema.json, which git ignores",
  "@zotlit/plugin-messages#generate:language-packs":
    "writes generated/, which git ignores; the typecheck and test tasks build it",
  "@zotlit/reader-messages#generate:language-packs":
    "writes generated/, which git ignores; the typecheck and test tasks build it",
  "@zotlit/zotero-types#generate:fixture":
    "downloads pinned Zotero client sources over the network",
};
