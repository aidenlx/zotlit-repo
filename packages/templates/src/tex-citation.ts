import type { CitationItemInput, CitationLocator } from "./citation-items.ts";
import { assertCitationItems } from "./citation-items.ts";

const CONTROL_WORD = /^[A-Za-z]+\*?$/u;

const UNSAFE_KEY = /[\s,\\{}%#~$^&]/u;

export type TexCitationErrorCode =
  | "invalid-input"
  | "unrepresentable-value"
  | "unsafe-affix";

export type TexCitationProperty =
  | "items"
  | "command"
  | "citationKey"
  | "prefix"
  | "suffix"
  | "locator"
  | "suppressAuthor";

export class TexCitationError extends Error {
  readonly code: TexCitationErrorCode;
  readonly itemIndex: number | null;
  readonly property: TexCitationProperty;

  constructor(
    code: TexCitationErrorCode,
    message: string,
    {
      itemIndex = null,
      property,
      cause,
    }: {
      itemIndex?: number | null;
      property: TexCitationProperty;
      cause?: unknown;
    },
  ) {
    super(message, { cause });
    this.name = "TexCitationError";
    this.code = code;
    this.itemIndex = itemIndex;
    this.property = property;
  }
}

const AFFIX_PARTS = [
  ["prefix", (item: CitationItemInput) => item.prefix],
  ["locator", (item: CitationItemInput) => locatorText(item.locator)],
  ["suffix", (item: CitationItemInput) => item.suffix],
] as const satisfies readonly (readonly [
  TexCitationProperty,
  (item: CitationItemInput) => string | null,
])[];

export function formatTexCitation(
  items: readonly CitationItemInput[],
  command = "cite",
): string {
  if (!CONTROL_WORD.test(command)) {
    throw new TexCitationError(
      "invalid-input",
      `LaTeX citation command must be a control word, optionally starred: ${JSON.stringify(command)}`,
      { property: "command" },
    );
  }
  assertCitationItems(
    items,
    (message, itemIndex) =>
      new TexCitationError("invalid-input", message, {
        itemIndex,
        property: "items",
      }),
  );
  const keyed = items.flatMap((item, itemIndex) =>
    item.citationKey === null ? [] : [{ item, itemIndex }],
  );
  if (keyed.length === 0) return "";

  for (const { item, itemIndex } of keyed) {
    assertKey(item.citationKey!, itemIndex);
    if (item.suppressAuthor) {
      throw unrepresentable(
        "LaTeX has no general Suppress Author form",
        "suppressAuthor",
        itemIndex,
      );
    }
  }
  for (const { item, itemIndex } of keyed.slice(1)) {
    for (const [property, read] of AFFIX_PARTS) {
      if (read(item) !== null) {
        throw unrepresentable(
          `a LaTeX citation command carries one prenote and one postnote, so only the first retained Citation Item may hold a ${property}`,
          property,
          itemIndex,
        );
      }
    }
  }

  const first = keyed[0]!;
  const prenote = formatAffix(
    (first.item.prefix ?? "").trim(),
    () => "prefix",
    first.itemIndex,
  );
  const locator = (locatorText(first.item.locator) ?? "").trimStart();
  const postnote = formatAffix(
    `${locator}${first.item.suffix ?? ""}`.trim(),
    (index) => (index < locator.length ? "locator" : "suffix"),
    first.itemIndex,
  );
  const keys = keyed.map(({ item }) => item.citationKey).join(",");
  const notes =
    prenote === ""
      ? postnote === ""
        ? ""
        : `[${postnote}]`
      : `[${prenote}][${postnote}]`;
  return `\\${command}${notes}{${keys}}`;
}

function locatorText(locator: CitationLocator | null): string | null {
  return locator === null ? null : `${locator.label} ${locator.value}`;
}

function assertKey(citationKey: string, itemIndex: number): void {
  if (citationKey !== "" && !UNSAFE_KEY.test(citationKey)) return;
  throw unrepresentable(
    `LaTeX cannot carry the citation key ${JSON.stringify(citationKey)}`,
    "citationKey",
    itemIndex,
  );
}

function unrepresentable(
  reason: string,
  property: TexCitationProperty,
  itemIndex: number,
): TexCitationError {
  return new TexCitationError(
    "unrepresentable-value",
    `Citation Item ${itemIndex + 1}: ${reason}`,
    { itemIndex, property },
  );
}

function formatAffix(
  value: string,
  propertyAt: (index: number) => TexCitationProperty,
  itemIndex: number,
): string {
  const fail = (index: number, reason: string): never => {
    const property = propertyAt(index);
    throw new TexCitationError(
      "unsafe-affix",
      `Citation Item ${itemIndex + 1} has a ${property} with ${reason}`,
      { itemIndex, property },
    );
  };
  let protectedText = "";
  let copiedUntil = 0;
  let index = 0;
  let depth = 0;
  let groupStart = 0;
  let commentStart: number | undefined;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "{") {
      if (depth === 0) groupStart = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) fail(index, "braces that do not balance");
    } else if (char === "%") {
      commentStart ??= index;
    } else if (char === "]") {
      protectedText += `${value.slice(copiedUntil, index)}{]}`;
      copiedUntil = index + 1;
    }
    index += char.length;
  }
  if (depth !== 0) fail(groupStart, "braces that do not balance");
  if (commentStart !== undefined) {
    fail(commentStart, "an unescaped % that would comment out the citation");
  }
  if (escaped) {
    fail(index - 1, "a trailing backslash that would escape the closing ]");
  }
  return protectedText + value.slice(copiedUntil);
}
