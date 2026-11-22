export const VERSION_KEY = "__VERSION__";

export type DiskClassification =
  | { kind: "missing" }
  | { kind: "legacy"; raw: Record<string, unknown> }
  | { kind: "v1"; raw: Record<string, unknown> }
  | { kind: "v2"; raw: Record<string, unknown> }
  | { kind: "v3"; raw: Record<string, unknown> }
  | { kind: "v4"; raw: Record<string, unknown> }
  | { kind: "v5"; raw: Record<string, unknown> }
  | { kind: "v6"; raw: Record<string, unknown> }
  | { kind: "v7"; raw: Record<string, unknown> }
  | { kind: "v8"; raw: Record<string, unknown> }
  | { kind: "v9"; raw: Record<string, unknown> }
  | { kind: "v10"; raw: Record<string, unknown> }
  | { kind: "v11"; raw: Record<string, unknown> }
  | { kind: "future"; version: number }
  | { kind: "malformed"; reason: string };

export type HydrationOrigin = "legacy" | "absent" | "malformed" | "current";

export function hydrationOriginOf(
  kind: DiskClassification["kind"],
): HydrationOrigin {
  switch (kind) {
    case "legacy":
      return "legacy";
    case "missing":
      return "absent";
    case "malformed":
      return "malformed";
    case "v1":
    case "v2":
    case "v3":
    case "v4":
    case "v5":
    case "v6":
    case "v7":
    case "v8":
    case "v9":
    case "v10":
    case "v11":
    case "future":
      return "current";
  }
}

export function classifyDiskData(raw: unknown): DiskClassification {
  if (raw === null) return { kind: "missing" };
  if (!isPlainObject(raw)) {
    return { kind: "malformed", reason: "data is not a plain object" };
  }
  if (!Object.hasOwn(raw, VERSION_KEY)) {
    return { kind: "legacy", raw };
  }
  const version = raw[VERSION_KEY];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return {
      kind: "malformed",
      reason: `__VERSION__ is not an integer (got ${describe(version)})`,
    };
  }
  if (version === 1) return { kind: "v1", raw };
  if (version === 2) return { kind: "v2", raw };
  if (version === 3) return { kind: "v3", raw };
  if (version === 4) return { kind: "v4", raw };
  if (version === 5) return { kind: "v5", raw };
  if (version === 6) return { kind: "v6", raw };
  if (version === 7) return { kind: "v7", raw };
  if (version === 8) return { kind: "v8", raw };
  if (version === 9) return { kind: "v9", raw };
  if (version === 10) return { kind: "v10", raw };
  if (version === 11) return { kind: "v11", raw };
  if (version > 11) return { kind: "future", version };
  return {
    kind: "malformed",
    reason: `__VERSION__ is not a positive integer (got ${version})`,
  };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  return typeof value;
}
