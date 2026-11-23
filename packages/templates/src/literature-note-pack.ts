import { regex } from "arkregex";

import type { TemplateLanguage } from "./constants.ts";
import { updateLiteratureNoteTemplateManifestKeys } from "./literature-note-template-manifest-edit.ts";
import { parseLiteratureNoteTemplate } from "./literature-note-template.ts";
import type {
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateManifest,
  LiteratureNoteTemplatePartial,
} from "./literature-note-template.ts";
import { formatPlainTemplateDocument } from "./plain-template-document.ts";

export type { LiteratureNoteTemplatePartial } from "./literature-note-template.ts";

export type LiteratureNotePackErrorCode =
  | "match-changed"
  | "missing-partial"
  | "install-refused"
  | "revert-refused";

export class LiteratureNotePackError extends Error {
  readonly _tag = "LiteratureNotePackError";
  readonly code: LiteratureNotePackErrorCode;
  readonly recovery: string;

  constructor(
    code: LiteratureNotePackErrorCode,
    message: string,
    options: ErrorOptions & { recovery: string },
  ) {
    super(message, options);
    this.name = "LiteratureNotePackError";
    this.code = code;
    this.recovery = options.recovery;
  }
}

export interface LiteratureNotePackFile {
  readonly key: string;
  readonly source: string;
}

export interface ParsedLiteratureNotePack {
  readonly pack: { readonly id: string; readonly version: string };
  readonly files: readonly LiteratureNotePackFile[];
}

export function parseLiteratureNotePack(
  reference: string,
  source: string,
): ParsedLiteratureNotePack {
  const document = parseLiteratureNoteTemplate(source);
  return {
    pack: {
      id: document.manifest.id,
      version: document.manifest.version,
    },
    files: [
      { key: `document:${reference}`, source },
      ...(document.manifest.partials ?? []).map((partial) => ({
        key: `partial:${partial.name}:${partial.language}`,
        source: partial.source,
      })),
    ],
  };
}

export type LiteratureNotePartialUnpackVerdict =
  | "write"
  | "unchanged"
  | "conflict"
  | "refused"
  | "other-case";

export interface LiteratureNotePartialUnpack {
  readonly name: string;
  readonly verdict: LiteratureNotePartialUnpackVerdict;
  readonly document: string;
}

export function unpackLiteratureNotePartials(
  bundled: readonly LiteratureNoteTemplatePartial[],
  held: ReadonlyMap<
    string,
    Pick<LiteratureNoteTemplatePartial, "language" | "source"> | null
  >,
  accepts: (name: string) => boolean = () => true,
): LiteratureNotePartialUnpack[] {
  return bundled.map((partial) => {
    const current = held.get(partial.name);
    const verdict: LiteratureNotePartialUnpackVerdict = !held.has(partial.name)
      ? accepts(partial.name)
        ? "write"
        : "refused"
      : current?.language === partial.language &&
          current.source === partial.source
        ? "unchanged"
        : "conflict";
    return {
      name: partial.name,
      verdict,
      document: formatPlainTemplateDocument(partial.source, partial.language),
    };
  });
}

export interface LiteratureNotePackCurrentFile {
  readonly key: string;
  readonly source: string | null;
  readonly builtIn: boolean;
}

export type LiteratureNotePackPreviousState =
  | { readonly kind: "absent" | "built-in" }
  | {
      readonly kind: "user-file" | "prior-pack";
      readonly source: string;
    };

export interface LiteratureNotePackInstallRecord {
  readonly pack: { readonly id: string; readonly version: string };
  readonly files: readonly {
    readonly key: string;
    readonly installedSource: string;
    readonly previous: LiteratureNotePackPreviousState;
  }[];
}

export interface LiteratureNotePackDiffRow {
  readonly key: string;
  readonly previous: LiteratureNotePackPreviousState["kind"];
  readonly verdict: "apply" | "unchanged" | "refuse";
  readonly currentSource: string | null;
  readonly candidateSource: string;
}

export function literatureNoteTemplateDependencies(
  document: LiteratureNoteTemplateDocument,
): string[] {
  const names = [
    document.body,
    document.annotationSection.source,
    document.manifest.filename,
  ].flatMap((source) =>
    referencedPartialNames(source, document.manifest.language),
  );
  return [...new Set(names)].sort();
}

export function updateLiteratureNotePackMetadata(
  source: string,
  changes: Partial<
    Pick<
      LiteratureNoteTemplateManifest,
      | "id"
      | "name"
      | "version"
      | "author"
      | "description"
      | "folder"
      | "citationStyle"
      | "importFolder"
      | "importColoredHighlights"
      | "importAnnotationsAsTemplate"
      | "partials"
    >
  >,
  options: { readonly includeMatch?: boolean } = {},
): string {
  const original = parseLiteratureNoteTemplate(source).manifest;
  const edits = Object.fromEntries(
    Object.entries({
      ...changes,
      ...(options.includeMatch === false ? { match: undefined } : {}),
    }).filter(
      ([key, value]) =>
        JSON.stringify(
          original[key as keyof LiteratureNoteTemplateManifest],
        ) !== JSON.stringify(value),
    ),
  );
  const content = updateLiteratureNoteTemplateManifestKeys(source, edits);
  if (
    options.includeMatch !== false &&
    JSON.stringify(parseLiteratureNoteTemplate(content).manifest.match) !==
      JSON.stringify(original.match)
  )
    throw new LiteratureNotePackError(
      "match-changed",
      "These metadata changes would also change the match conditions.",
      {
        recovery:
          "Write the match conditions independently of the metadata before changing these fields.",
      },
    );
  return content;
}

export function exportLiteratureNotePack(
  source: string,
  availablePartials: readonly LiteratureNoteTemplatePartial[],
  options: {
    readonly includeFolders?: boolean;
    readonly includeMatch?: boolean;
    readonly include?: readonly string[];
    readonly onMissingPartial?: (name: string) => void;
  } = {},
): string {
  const document = parseLiteratureNoteTemplate(source);
  const available = new Map(
    [...availablePartials, ...(document.manifest.partials ?? [])].map(
      (partial) => [partial.name, partial],
    ),
  );
  const bundled = new Map<string, LiteratureNoteTemplatePartial>();
  const reported = new Set<string>();
  const pending = [
    ...(options.include ?? []),
    ...[
      document.body,
      document.annotationSection.source,
      document.manifest.filename,
    ].flatMap((source) =>
      referencedPartialNames(source, document.manifest.language),
    ),
  ];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (name === "annotation" || bundled.has(name)) continue;
    const partial = available.get(name);
    if (!partial) {
      if (options.onMissingPartial) {
        if (!reported.has(name)) {
          reported.add(name);
          options.onMissingPartial(name);
        }
        continue;
      }
      throw new LiteratureNotePackError(
        "missing-partial",
        `Literature Note Template references missing partial '${name}'`,
        {
          recovery: "Add the missing partial, then export the Pack again.",
        },
      );
    }
    bundled.set(name, partial);
    pending.push(...referencedPartialNames(partial.source, partial.language));
  }
  const stripFolders =
    !options.includeFolders &&
    (document.manifest.folder !== undefined ||
      document.manifest.importFolder !== undefined);
  if (bundled.size === 0 && !stripFolders && options.includeMatch !== false)
    return source;

  const partials = [...bundled.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  return updateLiteratureNotePackMetadata(
    source,
    {
      ...(stripFolders ? { folder: undefined, importFolder: undefined } : {}),
      ...(bundled.size > 0 ? { partials } : {}),
    },
    { includeMatch: options.includeMatch },
  );
}

export function diffLiteratureNotePack(
  candidate: readonly LiteratureNotePackFile[],
  current: readonly LiteratureNotePackCurrentFile[],
  options: {
    readonly overwrite?: readonly string[];
    readonly prior?: LiteratureNotePackInstallRecord;
  } = {},
): LiteratureNotePackDiffRow[] {
  const currentByKey = new Map(current.map((file) => [file.key, file]));
  const priorByKey = new Map(
    options.prior?.files.map((file) => [file.key, file]) ?? [],
  );
  const overwrite = new Set(options.overwrite);
  return candidate.map((file) => {
    const effective = currentByKey.get(file.key) ?? {
      key: file.key,
      source: null,
      builtIn: false,
    };
    const prior = priorByKey.get(file.key);
    const previous =
      effective.source === null
        ? "absent"
        : effective.builtIn
          ? "built-in"
          : prior?.installedSource === effective.source
            ? "prior-pack"
            : "user-file";
    const verdict =
      effective.source === file.source
        ? "unchanged"
        : previous === "user-file" && !overwrite.has(file.key)
          ? "refuse"
          : "apply";
    return {
      key: file.key,
      previous,
      verdict,
      currentSource: effective.source,
      candidateSource: file.source,
    };
  });
}

export function createLiteratureNotePackInstallRecord(
  pack: LiteratureNotePackInstallRecord["pack"],
  candidate: readonly LiteratureNotePackFile[],
  diff: readonly LiteratureNotePackDiffRow[],
): LiteratureNotePackInstallRecord {
  const diffByKey = new Map(diff.map((row) => [row.key, row]));
  const refused = diff.find((row) => row.verdict === "refuse");
  if (refused) {
    throw new LiteratureNotePackError(
      "install-refused",
      `Pack install would overwrite user file '${refused.key}'`,
      {
        recovery: "Approve that file explicitly, then apply the Pack again.",
      },
    );
  }
  return {
    pack,
    files: candidate.map((file) => {
      const row = diffByKey.get(file.key)!;
      const previous: LiteratureNotePackPreviousState =
        row.previous === "absent" || row.previous === "built-in"
          ? { kind: row.previous }
          : { kind: row.previous, source: row.currentSource! };
      return { key: file.key, installedSource: file.source, previous };
    }),
  };
}

export type LiteratureNotePackRevertAction =
  | { readonly key: string; readonly action: "trash" }
  | {
      readonly key: string;
      readonly action: "restore";
      readonly source: string;
    };

export function planLiteratureNotePackRevert(
  record: LiteratureNotePackInstallRecord,
  current: readonly LiteratureNotePackFile[],
): LiteratureNotePackRevertAction[] {
  const currentByKey = new Map(current.map((file) => [file.key, file.source]));
  return record.files.map((file) => {
    if (currentByKey.get(file.key) !== file.installedSource) {
      throw new LiteratureNotePackError(
        "revert-refused",
        `Installed Pack file '${file.key}' was edited after installation`,
        {
          recovery:
            "Back up the edited file or approve its removal, then revert again.",
        },
      );
    }
    const previous = file.previous;
    if (!("source" in previous)) {
      return { key: file.key, action: "trash" };
    }
    return {
      key: file.key,
      action: "restore",
      source: previous.source,
    };
  });
}

const LIQUID_TOKEN =
  /{%-?\s*comment\s*-?%}[\s\S]*?(?:{%-?\s*endcomment\s*-?%}|$)|{%-?\s*raw\s*-?%}[\s\S]*?(?:{%-?\s*endraw\s*-?%}|$)|{{[\s\S]*?}}|{%[\s\S]*?%}/g;
const QUOTED_NAME = "(?<name>\"[^\"\\r\\n]*\"|'[^'\\r\\n]*')";
const LIQUID_PARTIAL = regex(`^{%-?\\s*(?:render|include)\\s+${QUOTED_NAME}`);
const LIQUID_BLOCK = /^{%-?\s*liquid\s/;
const LIQUID_BLOCK_PARTIAL = regex(
  `^\\s*(?:render|include)\\s+${QUOTED_NAME}`,
  "gm",
);
const ETA_TAG = /<%[\s\S]*?%>/g;
const ETA_PARTIAL = regex(
  `\\binclude\\s*\\(\\s*${QUOTED_NAME}\\s*(?=[,)])`,
  "g",
);

function referencedPartialNames(
  source: string,
  language: TemplateLanguage,
): string[] {
  if (language === "liquid") {
    return (source.match(LIQUID_TOKEN) ?? []).flatMap((token) => {
      if (LIQUID_BLOCK.test(token)) {
        const block = token.replace(LIQUID_BLOCK, "");
        const names: string[] = [];
        for (
          let match = LIQUID_BLOCK_PARTIAL.exec(block);
          match;
          match = LIQUID_BLOCK_PARTIAL.exec(block)
        ) {
          names.push(match.groups.name.slice(1, -1));
        }
        return names;
      }
      const match = LIQUID_PARTIAL.exec(token);
      return match ? [match.groups.name.slice(1, -1)] : [];
    });
  }

  const names: string[] = [];
  for (const tag of source.match(ETA_TAG) ?? []) {
    for (
      let match = ETA_PARTIAL.exec(tag);
      match;
      match = ETA_PARTIAL.exec(tag)
    ) {
      names.push(match.groups.name.slice(1, -1));
    }
  }
  return names;
}
