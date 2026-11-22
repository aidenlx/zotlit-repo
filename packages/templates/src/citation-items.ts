export interface CitationLocator {
  readonly label: string;
  readonly value: string;
}

export interface CitationItemInput {
  readonly citationKey: string | null;
  readonly prefix: string | null;
  readonly suffix: string | null;
  readonly locator: CitationLocator | null;
  readonly suppressAuthor: boolean;
}

export type InvalidCitationItems = (
  message: string,
  itemIndex: number | null,
) => Error;

export function mapCitationItems(
  value: unknown,
  filterName: string,
  invalid: InvalidCitationItems,
): CitationItemInput[] {
  if (!Array.isArray(value)) {
    throw invalid(`${filterName} requires a Citation Item array`, null);
  }
  return value.map((entry, itemIndex) => mapItem(entry, itemIndex, invalid));
}

export function assertCitationItems(
  items: readonly CitationItemInput[],
  invalid: InvalidCitationItems,
): void {
  if (!Array.isArray(items)) {
    throw invalid("Citation Items must be an array", null);
  }
  for (const [itemIndex, item] of items.entries()) {
    if (
      typeof item !== "object" ||
      item === null ||
      (typeof item.citationKey !== "string" && item.citationKey !== null) ||
      (typeof item.prefix !== "string" && item.prefix !== null) ||
      (typeof item.suffix !== "string" && item.suffix !== null) ||
      typeof item.suppressAuthor !== "boolean" ||
      !isLocator(item.locator)
    ) {
      throw invalid(
        `Citation Item ${itemIndex + 1} has an invalid shape`,
        itemIndex,
      );
    }
  }
}

function isLocator(value: unknown): value is CitationLocator | null {
  if (value === null) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { label?: unknown }).label === "string" &&
    typeof (value as { value?: unknown }).value === "string"
  );
}

function mapItem(
  value: unknown,
  itemIndex: number,
  invalid: InvalidCitationItems,
): CitationItemInput {
  const record = asRecord(value);
  const item = asRecord(record?.item);
  const citationKey = item?.citationKey;
  const prefix = record?.prefix;
  const suffix = record?.suffix;
  const locator = record?.locator;
  const labelShort = record?.labelShort;
  const suppressAuthor = record?.suppressAuthor;
  if (
    record === null ||
    item === null ||
    (typeof citationKey !== "string" && citationKey !== null) ||
    (typeof prefix !== "string" && prefix !== null) ||
    (typeof suffix !== "string" && suffix !== null) ||
    (typeof locator !== "string" && locator !== null) ||
    typeof suppressAuthor !== "boolean" ||
    (locator !== null && typeof labelShort !== "string")
  ) {
    throw invalid(
      `Citation Item ${itemIndex + 1} has an invalid template-data shape`,
      itemIndex,
    );
  }
  return {
    citationKey,
    prefix,
    suffix,
    locator:
      locator === null ? null : { label: labelShort as string, value: locator },
    suppressAuthor,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
