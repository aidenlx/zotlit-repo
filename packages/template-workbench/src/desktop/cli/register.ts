import { Context, Effect, Layer } from "effect";
import type { CliData, CliFlag, CliFlags } from "obsidian";

import {
  readCitationData,
  readTemplateData,
  withSelectedNote,
} from "@zotlit/notes/desktop/template/data.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { templateCall } from "@zotlit/notes/obsidian/template/sync-template.ts";
import type { VersionedCliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";

import type { CheckServices } from "./check.ts";
import {
  createCheckHandler,
  checkFlags,
  TEMPLATE_CHECK_COMMAND,
} from "./check.ts";
import {
  createTemplateWorkbenchHandlers,
  FRONTMATTER_EVAL_COMMAND,
  FRONTMATTER_REMOVE_COMMAND,
  FRONTMATTER_REORDER_COMMAND,
  FRONTMATTER_SET_COMMAND,
  FRONTMATTER_STATUS_COMMAND,
  TEMPLATE_DATA_COMMAND,
  TEMPLATE_DOCUMENT_RENDER_COMMAND,
  TEMPLATE_GUIDE_COMMAND,
  TEMPLATE_RENDER_COMMAND,
  TEMPLATE_SCHEMA_COMMAND,
  TEMPLATE_SOURCE_COMMAND,
  TEMPLATE_STATUS_COMMAND,
} from "./cli.ts";
import type { WorkbenchCommand } from "./envelope.ts";
import { diagnostic, envelope } from "./envelope.ts";
import { GUIDE_TOPIC_NAMES } from "./guide.ts";
import { readWorkbenchIdentity } from "./identity.ts";
import {
  createInspectHandler,
  selectInspectionNote,
  inspectFlags,
  TEMPLATE_INSPECT_COMMAND,
} from "./inspect.ts";
import type {
  DataParam,
  DocumentRenderParam,
  FrontmatterEvalParam,
  FrontmatterRemoveParam,
  FrontmatterReorderParam,
  FrontmatterSetParam,
  GuideParam,
  RenderParam,
  SourceParam,
} from "./request.ts";
import {
  CITATION_EXAMPLE_NAMES,
  CITATION_VARIANT_NAMES,
  FRONTMATTER_LANGUAGE_NAMES,
  FRONTMATTER_MERGE_NAMES,
  PARTIAL_CONTEXT_NAMES,
  RENDER_TEMPLATE_NAMES,
  TEMPLATE_SLOT_NAMES,
} from "./request.ts";

import { CONTRACT_ROOT_NAMES } from "#core/cli/schema.ts";
import { choices } from "#core/cli/vocabulary.ts";

export type WorkbenchServices = CheckServices;

export const layerTemplateWorkbenchCli: Layer.Layer<
  never,
  never,
  PluginHost | WorkbenchServices
> = Layer.effectDiscard(
  Effect.gen(function* () {
    registerTemplateWorkbench(
      yield* PluginHost,
      yield* Effect.context<WorkbenchServices>(),
    );
  }),
);

function keyFlag(): CliFlag {
  return {
    value: "<indexed-key>",
    description: "Zotero key for an object",
    required: true,
  };
}

function selectorKeyFlag(): CliFlag {
  return {
    value: "<indexed-key>",
    description:
      "Zotero key for an object; the citation root takes example instead",
  };
}

function exampleFlag(): CliFlag {
  return {
    value: choices(CITATION_EXAMPLE_NAMES),
    description: "Built-in citation set to read instead of key",
  };
}

function expectationFlags(): Record<"expect-source", CliFlag> {
  return {
    "expect-source": {
      value: "<source-id>",
      description: "Zotero source ID the call must match",
    },
  };
}

function rootFlag(): CliFlag {
  return {
    value: choices(CONTRACT_ROOT_NAMES),
    description: "Template data root",
    required: true,
  };
}

function formatFlag(values: readonly string[]): CliFlag {
  return {
    value: choices(values),
    description: "Output format, default json",
  };
}

function dataFlags(): CliFlags {
  return {
    key: selectorKeyFlag(),
    note: {
      value: "<vault-path>",
      description:
        "Literature Note selected as in template-inspect; alternative to key or example",
    },
    query: {
      value: "<words>",
      description:
        "Optional focused discovery: definitions, values, and expressions",
    },
    path: {
      value: "<zt.path>",
      description: "Exact nested field, such as zt.creators[0].family",
    },
    full: { description: "Explicitly include the complete zt object" },
    root: rootFlag(),
    example: exampleFlag(),
    format: formatFlag(["json"]),
    ...expectationFlags(),
  } satisfies Record<DataParam, CliFlag>;
}

function guideFlags(): CliFlags {
  return {
    topic: {
      value: choices(GUIDE_TOPIC_NAMES),
      description: "Guide topic",
    },
  } satisfies Record<GuideParam, CliFlag>;
}

function renderFlags(): CliFlags {
  return {
    key: selectorKeyFlag(),
    template: {
      value: choices(RENDER_TEMPLATE_NAMES),
      description: "Template to render",
      required: true,
    },
    root: {
      value: choices(PARTIAL_CONTEXT_NAMES),
      description:
        "Caller a partial is rendered as, for template=partial:<name>, default note",
    },
    variant: {
      value: choices(CITATION_VARIANT_NAMES),
      description: "Citation Variant for template=citation, default main",
    },
    example: exampleFlag(),
    format: formatFlag(["markdown", "json"]),
    ...expectationFlags(),
  } satisfies Record<RenderParam, CliFlag>;
}

function documentRenderFlags(): CliFlags {
  return {
    key: keyFlag(),
    profile: {
      value: "<default|profile-id>",
      description: "Profile id whose document to render",
    },
    document: {
      value: "<reference>",
      description: "Installed document reference to render",
    },
    source: {
      value: "<document-source>",
      description: "Uninstalled document source to render in memory",
    },
    ...expectationFlags(),
  } satisfies Record<DocumentRenderParam, CliFlag>;
}

function sourceFlags(): CliFlags {
  return {
    template: {
      value: choices(TEMPLATE_SLOT_NAMES),
      description: "Template to render",
      required: true,
    },
  } satisfies Record<SourceParam, CliFlag>;
}

function frontmatterEvalFlags(): CliFlags {
  return {
    key: keyFlag(),
    expr: {
      value: "<expression>",
      description:
        "Ad-hoc frontmatter expression to evaluate instead of the configured fields",
    },
    language: {
      value: choices(FRONTMATTER_LANGUAGE_NAMES),
      description: "Language of expr, default liquid",
    },
    format: formatFlag(["json"]),
    ...expectationFlags(),
  } satisfies Record<FrontmatterEvalParam, CliFlag>;
}

function frontmatterSetFlags(): CliFlags {
  return {
    field: {
      value: "<key>",
      description: "Managed Frontmatter field key to add or update",
      required: true,
    },
    expr: {
      value: "<expression>",
      description:
        "Field expression; required for a new field, keeps the current expression when omitted on an existing field",
    },
    language: {
      value: choices(FRONTMATTER_LANGUAGE_NAMES),
      description:
        "Field language; defaults to liquid on a new field, keeps the current language when omitted on an existing field",
    },
    merge: {
      value: choices(FRONTMATTER_MERGE_NAMES),
      description:
        "Merge strategy; defaults to replace on a new field, keeps the current strategy when omitted on an existing field",
    },
  } satisfies Record<FrontmatterSetParam, CliFlag>;
}

function frontmatterRemoveFlags(): CliFlags {
  return {
    field: {
      value: "<key>",
      description: "Managed Frontmatter field key to delete",
      required: true,
    },
  } satisfies Record<FrontmatterRemoveParam, CliFlag>;
}

function frontmatterReorderFlags(): CliFlags {
  return {
    order: {
      value: "<k1,k2,...>",
      description:
        "Complete, comma-separated permutation of the configured field keys, in write order",
      required: true,
    },
  } satisfies Record<FrontmatterReorderParam, CliFlag>;
}

export function registerTemplateWorkbench(
  host: VersionedCliHost,
  context: Context.Context<WorkbenchServices>,
): void {
  const provide = <A, E>(effect: Effect.Effect<A, E, WorkbenchServices>) =>
    Effect.provideContext(effect, context);
  const handle =
    <E>(
      handler: (params: CliData) => Effect.Effect<string, E, WorkbenchServices>,
    ) =>
    (params: CliData) =>
      provide(handler(params));
  const template = Context.get(context, Template);
  const profile = Context.get(context, Profile);
  host.registerCliCommand(TEMPLATE_INSPECT_COMMAND, {
    description:
      "Inspect a Template Document and verify saved source freshness",
    flags: inspectFlags,
    handler: handle(createInspectHandler()),
  });
  host.registerCliCommand(TEMPLATE_CHECK_COMMAND, {
    description:
      "Check every saved Profile create or update component with verified source freshness",
    flags: checkFlags,
    handler: handle(
      createCheckHandler({
        pluginVersion: host.manifest.version,
        hostVersion: `Obsidian ${Context.get(context, ObsidianEnv).apiVersion}`,
      }),
    ),
  });
  const handlers = createTemplateWorkbenchHandlers({
    pluginVersion: host.manifest.version,
    getIdentity: provide(readWorkbenchIdentity),
    selectNote: (name) => provide(selectInspectionNote(name)),
    loadData: (indexedKey, root, options) => {
      const read = readTemplateData(indexedKey, root);
      return provide(
        options?.note === undefined
          ? read
          : read.pipe(
              withSelectedNote({ key: indexedKey, path: options.note }),
            ),
      );
    },
    loadCitation: (selector, variant) =>
      provide(readCitationData(selector, variant)),
    templates: template,
    literatureNotes: {
      readProfiles: Effect.gen(function* () {
        const resolve = (selector: ProfileSelector) =>
          profile.resolveProfile(selector);
        return {
          defaultProfile: yield* resolve("default"),
          profiles: yield* Effect.forEach(yield* profile.profiles, (entry) =>
            Effect.map(resolve(entry.id), (resolved) => ({
              ...entry,
              bindings: resolved!.bindings,
            })),
          ),
          diagnostics: yield* profile.diagnostics,
        };
      }),
      getDocumentStatuses: Effect.suspend(
        () => template.getLiteratureNoteTemplateStatuses,
      ),
      getDocument: (reference) =>
        templateCall(template.getLiteratureNoteTemplate(reference)),
      renderSource: (source, data) =>
        templateCall(template.renderLiteratureNoteTemplateSource(source, data)),
    },
  });

  const registerRetired = (
    command: WorkbenchCommand,
    flags: CliFlags | null,
  ) => {
    host.registerCliCommand(command, {
      description:
        "Retired: use template-inspect, template-data, and template-check",
      flags:
        flags === null
          ? null
          : Object.fromEntries(
              Object.entries(flags).map(([name, flag]) => [
                name,
                { ...flag, required: false, description: "Retired parameter" },
              ]),
            ),
      handler: () =>
        Effect.succeed(
          envelope(command, {
            ok: false,
            diagnostic: diagnostic(
              "COMMAND_RETIRED",
              `${command} is retired from Template Document authoring.`,
            ),
          }),
        ),
    });
  };

  host.registerCliCommand(TEMPLATE_STATUS_COMMAND, {
    description: "Report ZotLit Template Workbench state",
    flags: null,
    handler: handlers[TEMPLATE_STATUS_COMMAND],
  });
  host.registerCliCommand(TEMPLATE_DATA_COMMAND, {
    description: "Return serialized ZotLit Template data, payload under 'zt'",
    flags: dataFlags(),
    handler: handlers[TEMPLATE_DATA_COMMAND],
  });
  registerRetired(TEMPLATE_SCHEMA_COMMAND, null);
  registerRetired(TEMPLATE_RENDER_COMMAND, renderFlags());
  registerRetired(TEMPLATE_DOCUMENT_RENDER_COMMAND, documentRenderFlags());
  host.registerCliCommand(TEMPLATE_GUIDE_COMMAND, {
    description: "Print the ZotLit Template Workbench guide",
    flags: guideFlags(),
    handler: handlers[TEMPLATE_GUIDE_COMMAND],
  });
  registerRetired(TEMPLATE_SOURCE_COMMAND, sourceFlags());
  registerRetired(FRONTMATTER_STATUS_COMMAND, null);
  registerRetired(FRONTMATTER_EVAL_COMMAND, frontmatterEvalFlags());
  registerRetired(FRONTMATTER_SET_COMMAND, frontmatterSetFlags());
  registerRetired(FRONTMATTER_REMOVE_COMMAND, frontmatterRemoveFlags());
  registerRetired(FRONTMATTER_REORDER_COMMAND, frontmatterReorderFlags());
}
