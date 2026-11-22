export interface PackEntryPin {
  readonly version: string;
  readonly sha256: string;
}

export type PackPins = Readonly<Record<string, PackEntryPin>>;

function isPin(value: unknown): value is PackEntryPin {
  if (typeof value !== "object" || value === null) return false;
  const { version, sha256 } = value as Record<string, unknown>;
  return typeof version === "string" && typeof sha256 === "string";
}

export function parsePackPins(packageJson: unknown): PackPins {
  const entries =
    typeof packageJson === "object" && packageJson !== null
      ? (packageJson as Record<string, unknown>).packEntries
      : undefined;
  if (
    typeof entries !== "object" ||
    entries === null ||
    !Object.values(entries).every(isPin)
  ) {
    throw new Error(
      "package.json needs `packEntries`: a `version` and a `sha256` for each Pack Entry",
    );
  }
  return entries as PackPins;
}
