export interface SnapshotItem {
  itemID: number;
  libraryID: number;
  key: string;
  indexedKey: string;
}

export type CitekeyResolution =
  | { kind: "missing" }
  | { kind: "unique"; item: SnapshotItem }
  | { kind: "ambiguous"; candidates: readonly SnapshotItem[] };

export interface CitationLookupRequest {
  citekeys?: readonly string[];
  indexedKeys?: readonly string[];
  annotationKeys?: readonly string[];
}

export interface AnnotationParent {
  readonly indexedKey: string;
  readonly citekey: string | null;
}

export interface CitationLookupWireAnswer {
  readonly revision: string;
  readonly citekeys: ReadonlyMap<string, CitekeyResolution>;
  readonly indexedKeys: ReadonlyMap<string, string | null>;
  readonly annotationKeys: ReadonlyMap<string, AnnotationParent | null>;
}

export class CitationLookupAnswer {
  readonly revision;
  readonly #citekeys;
  readonly #indexedKeys;
  readonly #annotationKeys;

  constructor(answer: CitationLookupWireAnswer) {
    this.revision = answer.revision;
    this.#citekeys = answer.citekeys;
    this.#indexedKeys = answer.indexedKeys;
    this.#annotationKeys = answer.annotationKeys;
  }

  covers(citekey: string): boolean {
    return this.#citekeys.has(citekey);
  }

  coversIndexedKey(indexedKey: string): boolean {
    return this.#indexedKeys.has(indexedKey);
  }

  coversAnnotationKey(indexedKey: string): boolean {
    return this.#annotationKeys.has(indexedKey);
  }

  parentOfAnnotation(indexedKey: string): AnnotationParent | null {
    const parent = this.#annotationKeys.get(indexedKey);
    if (parent === undefined)
      throw new Error(
        `Annotation Indexed Key "${indexedKey}" was not requested`,
      );
    return parent;
  }

  resolve(citekey: string): CitekeyResolution {
    const resolution = this.#citekeys.get(citekey);
    if (resolution === undefined)
      throw new Error(`Citation key "${citekey}" was not requested`);
    return resolution;
  }

  citekeyOf(indexedKey: string): string | null {
    const citekey = this.#indexedKeys.get(indexedKey);
    if (citekey === undefined)
      throw new Error(`Indexed Key "${indexedKey}" was not requested`);
    return citekey;
  }
}

export function heldResolution(
  answer: CitationLookupAnswer | null,
  citekey: string,
): CitekeyResolution | null {
  return answer?.covers(citekey) ? answer.resolve(citekey) : null;
}

export function heldCitekeyOf(
  answer: CitationLookupAnswer | null,
  indexedKey: string,
): string | null | undefined {
  return answer?.coversIndexedKey(indexedKey)
    ? answer.citekeyOf(indexedKey)
    : undefined;
}
