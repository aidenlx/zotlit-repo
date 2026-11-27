import type { Effect } from "effect";
import type { CliData } from "obsidian";

import {
  cliIndexedKey,
  cliMap,
  cliNotApplicable,
  cliParams,
  cliValue,
  cliVariants,
  decodeCliParams,
  expectSourceParam,
  noCliParams,
} from "@zotlit/obsidian-kit/cli-params.ts";
import type {
  CliOutput,
  CliParamName,
  CliRejection,
} from "@zotlit/obsidian-kit/cli-params.ts";

import type { CitationsIdentity, Diagnostic } from "./envelope.ts";
import { diagnostic } from "./envelope.ts";

const SELECTOR_EXCLUSIVITY_MESSAGE =
  "cited-by takes exactly one of key=<zotero-key> or citekey=<citation-key>.";

const citedByParams = cliVariants(
  ({ key, citekey }) =>
    key === undefined && citekey !== undefined ? "citekey" : "key",
  {
    key: cliParams(
      {
        citekey: cliNotApplicable(
          `${SELECTOR_EXCLUSIVITY_MESSAGE} Both were set.`,
        ),
        key: cliValue("key").check(cliIndexedKey(malformedKeyMessage)),
        "expect-source": expectSourceParam,
      },
      { key: `${SELECTOR_EXCLUSIVITY_MESSAGE} Neither was set.` },
    ).pipe(cliMap(({ key }) => ({ key }))),
    citekey: cliParams({
      citekey: cliValue("citekey"),
      "expect-source": expectSourceParam,
    }).pipe(cliMap(({ citekey }) => ({ citekey }))),
  },
);

export type CitedBySelector = CliOutput<typeof citedByParams>;

export type CitedByParam = CliParamName<typeof citedByParams>;

export function parseCitedByRequest(
  params: CliData,
): Effect.Effect<CitedBySelector, CliRejection> {
  return decodeCliParams(params, citedByParams, { command: "cited-by" });
}

const annotationUsesParams = cliParams({
  key: cliValue("key").check(
    cliIndexedKey(
      () =>
        "Use key=<annotation-key>: an 8-character Annotation key, with a 'g<group-id>' suffix for a group library.",
    ),
  ),
  "expect-source": expectSourceParam,
}).pipe(cliMap(({ key }) => ({ key })));

export type AnnotationUsesParam = CliParamName<typeof annotationUsesParams>;

export function parseAnnotationUsesRequest(params: CliData) {
  return decodeCliParams(params, annotationUsesParams, {
    command: "annotation-uses",
  });
}

const referencesParams = cliParams(
  { file: cliValue("file"), "expect-source": expectSourceParam },
  {
    file: "references takes the vault-relative path of one Markdown note, as file=folder/note.md.",
  },
).pipe(cliMap(({ file }) => ({ file })));

export type ReferencesSelector = CliOutput<typeof referencesParams>;

export type ReferencesParam = CliParamName<typeof referencesParams>;

export function parseReferencesRequest(
  params: CliData,
): Effect.Effect<ReferencesSelector, CliRejection> {
  return decodeCliParams(params, referencesParams, { command: "references" });
}

const guideParams = noCliParams.pipe(cliMap(() => null));

export function parseGuideRequest(
  params: CliData,
): Effect.Effect<null, CliRejection> {
  return decodeCliParams(params, guideParams, { command: "citations-guide" });
}

export function targetMismatch(
  params: CliData,
  identity: CitationsIdentity,
): Diagnostic | null {
  const expectedSource = params["expect-source"];
  const actual = identity.source?.id ?? null;
  if (expectedSource !== undefined && expectedSource !== actual) {
    return diagnostic(
      "TARGET_MISMATCH",
      `Expected Zotero source '${expectedSource}', connected to '${actual ?? "unresolved"}'.`,
      {
        target: "source",
        expected: expectedSource,
        actual,
      },
    );
  }
  return null;
}

function malformedKeyMessage(key: string): string {
  return (
    `'${key}' is not a Zotero key. A Zotero key is an 8-character item key, ` +
    "with a 'g<group-id>' suffix for an item in a group library. " +
    "To select by citation key instead, use citekey=<citation-key>."
  );
}
