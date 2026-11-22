import { CitationLookupAnswer } from "#contract/citation-lookup.ts";
import type { CitekeyResolution } from "#contract/citation-lookup.ts";

export function lookupAnswer(
  citekeys: Record<string, CitekeyResolution> = {},
  indexedKeys: Record<string, string | null> = {},
  revision = "fixture:1",
): CitationLookupAnswer {
  return new CitationLookupAnswer({
    annotationKeys: new Map(),
    revision,
    citekeys: new Map(Object.entries(citekeys)),
    indexedKeys: new Map(Object.entries(indexedKeys)),
  });
}

export function lookupAnswerFor(
  requested: readonly string[],
  resolutions: Readonly<Record<string, CitekeyResolution>> = {},
  revision = "fixture:1",
): CitationLookupAnswer {
  return lookupAnswer(
    Object.fromEntries(
      requested.map((citekey) => [
        citekey,
        resolutions[citekey] ?? { kind: "missing" as const },
      ]),
    ),
    {},
    revision,
  );
}

export function lookupForWorks(
  works: ReadonlyMap<string, string | null>,
): CitationLookupAnswer {
  return lookupAnswer(Object.fromEntries([...works].map(([citekey, indexedKey]) => [citekey,
    indexedKey === null ? { kind: "missing" as const } : {
      kind: "unique" as const,
      item: {itemID: 1, libraryID: 1, key: indexedKey, indexedKey},
    },
  ])));
}
