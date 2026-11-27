import { Effect, Layer } from "effect";
import type { CliFlag, CliFlags } from "obsidian";

import type { CliHost } from "@zotlit/obsidian-kit/cli-command.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { readSourceIdentity } from "@zotlit/plugin-services/obsidian/library-source/identity.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { SourceIdentity } from "@zotlit/zotero-reads/contract/source-identity.ts";

import {
  ANNOTATION_USES_COMMAND,
  CITATIONS_GUIDE_COMMAND,
  CITED_BY_COMMAND,
  createCitationsCliHandlers,
  REFERENCES_COMMAND,
} from "./commands.ts";
import type {
  AnnotationUsesParam,
  CitedByParam,
  ReferencesParam,
} from "./request.ts";

import { CitationIndex } from "#obsidian/citation-index/service.ts";

interface CitationsCliRegistrationDeps {
  vaultName: string;
  vaultDisk: Pick<VaultDisk["Service"], "basePath">;
  citationIndex: Pick<
    CitationIndex["Service"],
    "readCitedBy" | "readReferences" | "readAnnotationUses"
  >;
  readSource: Effect.Effect<SourceIdentity | null>;
}

export const layerCitationsCli: Layer.Layer<
  never,
  never,
  PluginHost | ObsidianEnv | VaultDisk | CitationIndex | ZoteroReads
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* PluginHost;
    registerCitationsCli(host, {
      vaultName: (yield* ObsidianEnv).vaultName,
      vaultDisk: yield* VaultDisk,
      citationIndex: yield* CitationIndex,
      readSource: Effect.provideContext(
        readSourceIdentity,
        yield* Effect.context<ZoteroReads>(),
      ),
    });
  }),
);

function citedByFlags(): CliFlags {
  return {
    key: {
      value: "<zotero-key>",
      description: "Zotero key of the item; use instead of citekey",
    },
    citekey: {
      value: "<citation-key>",
      description: "Citation key of the item; use instead of key",
    },
    "expect-source": {
      value: "<source-id>",
      description: "Zotero source ID the call must match",
    },
  } satisfies Record<CitedByParam, CliFlag>;
}

function referencesFlags(): CliFlags {
  return {
    file: {
      value: "<vault-path>",
      description: "Vault path of the note, such as notes/review.md",
      required: true,
    },
    "expect-source": {
      value: "<source-id>",
      description: "Zotero source ID the call must match",
    },
  } satisfies Record<ReferencesParam, CliFlag>;
}

export function registerCitationsCli(
  host: CliHost,
  deps: CitationsCliRegistrationDeps,
): void {
  const handlers = createCitationsCliHandlers({
    getIdentity: () =>
      Effect.map(deps.readSource, (source) => ({
        vault: {
          name: deps.vaultName,
          path: deps.vaultDisk.basePath,
        },
        source,
      })),
    index: deps.citationIndex,
  });

  host.registerCliCommand(ANNOTATION_USES_COMMAND, {
    description:
      "List the notes that use one Zotero annotation, with every occurrence",
    flags: {
      key: {
        value: "<annotation-key>",
        description:
          "Annotation key, with a g<group-id> suffix for a group library",
        required: true,
      },
      "expect-source": {
        value: "<source-id>",
        description: "Zotero source ID the call must match",
      },
    } satisfies Record<AnnotationUsesParam, CliFlag>,
    handler: handlers[ANNOTATION_USES_COMMAND],
  });
  host.registerCliCommand(CITED_BY_COMMAND, {
    description:
      "List the notes that cite one Zotero item, with the position of every citation",
    flags: citedByFlags(),
    handler: handlers[CITED_BY_COMMAND],
  });
  host.registerCliCommand(REFERENCES_COMMAND, {
    description:
      "List what one note cites, with the position of every citation",
    flags: referencesFlags(),
    handler: handlers[REFERENCES_COMMAND],
  });
  host.registerCliCommand(CITATIONS_GUIDE_COMMAND, {
    description: "Print the ZotLit citations CLI guide",
    flags: null,
    handler: handlers[CITATIONS_GUIDE_COMMAND],
  });
}
