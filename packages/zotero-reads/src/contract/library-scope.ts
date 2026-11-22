import { regex } from "arkregex";
import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import * as v from "valibot";

import type { Library } from "@zotlit/db";

const groupID = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

export const librarySelectorSchema = v.variant("type", [
  v.object({ type: v.literal("personal") }),
  v.object({ type: v.literal("group"), groupID }),
]);

export type LibrarySelector = v.InferOutput<typeof librarySelectorSchema>;

const selectedLibraries = v.pipe(
  v.array(librarySelectorSchema),
  v.minLength(1, "Selected libraries must name at least one library"),
  v.check(
    isCanonicalOrder,
    "Selected libraries must be unique and in canonical order",
  ),
  v.readonly(),
);

export const libraryScopeSchema = v.variant("mode", [
  v.object({ mode: v.literal("all") }),
  v.object({ mode: v.literal("selected"), libraries: selectedLibraries }),
]);

export type LibraryScope = v.InferOutput<typeof libraryScopeSchema>;

const librarySelectorWire = Schema.Union([
  Schema.Struct({ type: Schema.Literal("personal") }),
  Schema.Struct({
    type: Schema.Literal("group"),
    groupID: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  }),
]);

export const libraryScopeWire = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("all") }),
  Schema.Struct({
    mode: Schema.Literal("selected"),
    libraries: Schema.Array(librarySelectorWire),
  }),
]);

export const DEFAULT_LIBRARY_SCOPE: LibraryScope = Object.freeze({
  mode: "all",
});

export const MY_LIBRARY_SCOPE: LibraryScope = Object.freeze({
  mode: "selected",
  libraries: Object.freeze([Object.freeze({ type: "personal" as const })]),
});

export type ScopeLibrary = Pick<
  Library,
  "libraryID" | "type" | "groupID" | "name"
>;

export interface AvailableLibrary {
  selector: LibrarySelector;
  libraryID: number;
  name: string | null;
}

export interface ResolvedLibraryScope {
  mode: LibraryScope["mode"];
  invalid: boolean;
  available: readonly AvailableLibrary[];
  unavailable: readonly LibrarySelector[];
}

export function selectorKey(selector: LibrarySelector): string {
  return selector.type === "personal"
    ? "personal"
    : `group:${selector.groupID}`;
}

const GROUP_SELECTOR_KEY = regex("^group:([1-9]\\d*)$");

export function selectorKeySchema(message: (text: string) => string) {
  return Schema.String.pipe(
    Schema.decodeTo(librarySelectorWire, {
      decode: SchemaGetter.transformEffect((text: string, options) => {
        const selector = parseSelectorKey(text);
        return selector
          ? Effect.succeed(selector)
          : Effect.fail(
              new SchemaIssue.InvalidValue(
                { message: message(text) },
                text,
                options,
              ),
            );
      }),
      encode: SchemaGetter.transform((selector) => selectorKey(selector)),
    }),
  );
}

function parseSelectorKey(text: string): LibrarySelector | null {
  if (text === "personal") return { type: "personal" };
  const group = GROUP_SELECTOR_KEY.exec(text);
  if (!group) return null;
  const groupID = Number(group[1]);
  return Number.isSafeInteger(groupID) ? { type: "group", groupID } : null;
}

export function compareSelectors(
  a: LibrarySelector,
  b: LibrarySelector,
): number {
  if (a.type !== b.type) return a.type === "personal" ? -1 : 1;
  if (a.type === "personal" || b.type === "personal") return 0;
  return a.groupID - b.groupID;
}

function isCanonicalOrder(selectors: LibrarySelector[]): boolean {
  return selectors.every(
    (selector, index) =>
      index === 0 || compareSelectors(selectors[index - 1]!, selector) < 0,
  );
}

export function selectorOf(library: ScopeLibrary): LibrarySelector | null {
  if (library.type === "user") return { type: "personal" };
  return library.groupID === null
    ? null
    : { type: "group", groupID: library.groupID };
}

export function resolveLibraryScope(
  libraries: readonly ScopeLibrary[],
  scope: LibraryScope | null,
): ResolvedLibraryScope {
  const invalid = scope === null;
  const effective = scope ?? MY_LIBRARY_SCOPE;

  if (effective.mode === "all") {
    const available = libraries
      .flatMap((library) => {
        const selector = selectorOf(library);
        return selector
          ? [{ selector, libraryID: library.libraryID, name: library.name }]
          : [];
      })
      .sort((a, b) => compareSelectors(a.selector, b.selector));
    return { mode: "all", invalid, available, unavailable: [] };
  }

  const available: AvailableLibrary[] = [];
  const unavailable: LibrarySelector[] = [];
  for (const selector of effective.libraries) {
    const library = libraries.find((candidate) =>
      matchesSelector(candidate, selector),
    );
    if (library) {
      available.push({
        selector,
        libraryID: library.libraryID,
        name: library.name,
      });
    } else {
      unavailable.push(selector);
    }
  }
  return { mode: "selected", invalid, available, unavailable };
}

function matchesSelector(
  library: ScopeLibrary,
  selector: LibrarySelector,
): boolean {
  return selector.type === "personal"
    ? library.type === "user"
    : library.type === "group" && library.groupID === selector.groupID;
}

export function sameResolution(
  a: ResolvedLibraryScope | null,
  b: ResolvedLibraryScope | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.mode === b.mode &&
    a.invalid === b.invalid &&
    sameArray(
      a.available,
      b.available,
      (x, y) =>
        x.libraryID === y.libraryID &&
        x.name === y.name &&
        selectorKey(x.selector) === selectorKey(y.selector),
    ) &&
    sameArray(
      a.unavailable,
      b.unavailable,
      (x, y) => selectorKey(x) === selectorKey(y),
    )
  );
}

function sameArray<T>(
  a: readonly T[],
  b: readonly T[],
  equal: (x: T, y: T) => boolean,
): boolean {
  return a.length === b.length && a.every((item, i) => equal(item, b[i]!));
}
