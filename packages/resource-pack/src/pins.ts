// The pins of a Resource Pack's entries: the `packEntries` field of the pack
// app's package.json. The pack build checks each binary against its pin, and
// the bundle check reads each built entry back against the same pin.

/** What the build pins a Pack Entry to. */
export interface PackEntryPin {
  /** The version of the upstream package that holds the binary. */
  readonly version: string;
  /** Lowercase hex SHA-256 of the binary. */
  readonly sha256: string;
}

/** The pins of a pack's entries, by entry name. */
export type PackPins = Readonly<Record<string, PackEntryPin>>;

function isPin(value: unknown): value is PackEntryPin {
  if (typeof value !== "object" || value === null) return false;
  const { version, sha256 } = value as Record<string, unknown>;
  return typeof version === "string" && typeof sha256 === "string";
}

/**
 * The pins that a pack app's package.json states.
 *
 * @throws when `packEntries` is not a pin for each entry name.
 */
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
