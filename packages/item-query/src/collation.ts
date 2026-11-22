const COLLATOR = new Intl.Collator("en", {
  usage: "sort",
  sensitivity: "variant",
  numeric: false,
  caseFirst: "false",
  ignorePunctuation: false,
});

export function compareStrings(a: string, b: string): number {
  return COLLATOR.compare(a, b);
}

export function compareScalars(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a !== typeof b) return compareStrings(typeof a, typeof b);
  if (typeof a === "string") return compareStrings(a, b as string);
  return Number(a) - Number(b);
}
