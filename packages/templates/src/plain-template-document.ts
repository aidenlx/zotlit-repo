import * as v from "valibot";

import type { TemplateLanguage } from "./constants.ts";
import {
  parseManifestYaml,
  splitDocumentFrontmatter,
} from "./document-frontmatter.ts";

const manifestSchema = v.strictObject({
  language: v.optional(v.picklist(["liquid", "eta"]), "liquid"),
});

export interface PlainTemplateDocumentManifest {
  readonly language: TemplateLanguage;
}

export interface PlainTemplateDocument {
  readonly manifest: PlainTemplateDocumentManifest;
  readonly source: string;
  readonly sourceStart: number;
}

export type PlainTemplateDocumentErrorCode =
  | "invalid-document"
  | "invalid-manifest";

export class PlainTemplateDocumentError extends Error {
  readonly _tag = "PlainTemplateDocumentError";
  readonly code: PlainTemplateDocumentErrorCode;
  readonly recovery: string;
  readonly offset: number;

  constructor(
    code: PlainTemplateDocumentErrorCode,
    message: string,
    {
      recovery,
      offset,
      ...options
    }: ErrorOptions & { recovery: string; offset: number },
  ) {
    super(message, options);
    this.name = "PlainTemplateDocumentError";
    this.code = code;
    this.recovery = recovery;
    this.offset = offset;
  }
}

export function formatPlainTemplateDocument(
  source: string,
  language: TemplateLanguage,
): string {
  return `---\nlanguage: ${language}\n---\n${source}`;
}

export function parsePlainTemplateDocument(
  source: string,
): PlainTemplateDocument {
  const split = splitDocumentFrontmatter(source);
  if (split.kind === "no-manifest") {
    return {
      manifest: { language: "liquid" },
      source,
      sourceStart: 0,
    };
  }
  if (split.kind === "unclosed-manifest") {
    throw new PlainTemplateDocumentError(
      "invalid-document",
      "Template document manifest is not closed",
      {
        recovery: 'Add a closing "---" line before the template source.',
        offset: source.length,
      },
    );
  }

  const { manifestSource, manifestStart, bodyStart } = split;
  const result = v.safeParse(
    manifestSchema,
    parseManifestYaml(
      manifestSource,
      manifestStart,
      ({ message, offset, cause }) =>
        new PlainTemplateDocumentError(
          "invalid-manifest",
          `Invalid template document manifest: ${message}`,
          {
            recovery: "Correct the YAML syntax in the manifest.",
            offset,
            cause,
          },
        ),
    ) ?? {},
  );
  if (!result.success) {
    const issue = result.issues[0];
    throw new PlainTemplateDocumentError(
      "invalid-manifest",
      `Invalid template document manifest: ${issue.message}`,
      {
        recovery: "Keep 'language: liquid' or 'language: eta' as the only key.",
        offset: manifestStart,
        cause: issue,
      },
    );
  }

  return {
    manifest: result.output,
    source: source.slice(bodyStart),
    sourceStart: bodyStart,
  };
}
