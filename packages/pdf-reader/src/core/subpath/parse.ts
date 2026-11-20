export interface Subpath {
  readonly raw: string;
  readonly page: number | null;
  readonly offset: readonly [number, number, number] | null;
  readonly selection: readonly [number, number, number, number] | null;
  readonly annotation: string | null;
  readonly height: number | null;
  readonly dest: string | null;
  readonly zoom: string | null;
  readonly search: string | null;
  readonly params: ReadonlyMap<string, string>;
}

export function integerOf(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function integers(value: string | undefined, count: number): number[] | null {
  const parts = (value ?? "").split(",");
  const values: number[] = [];
  for (let index = 0; index < count; index++) {
    const parsed = integerOf(parts[index]);
    if (parsed === null) return null;
    values.push(parsed);
  }
  return values;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseSubpath(raw: string): Subpath {
  const fragment = raw.startsWith("#") ? raw.slice(1) : raw;
  const keyed = fragment.includes("=");
  const params = new Map<string, string>();
  if (keyed) {
    for (const [key, value] of new URLSearchParams(fragment)) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  const page = params.has("page") ? (integerOf(params.get("page")) ?? 1) : null;
  const offset = page === null ? null : integers(params.get("offset"), 3);
  const selection =
    page === null || params.has("annotation")
      ? null
      : integers(params.get("selection"), 4);
  return {
    raw,
    page,
    offset: offset as Subpath["offset"],
    selection: selection as Subpath["selection"],
    annotation: page === null ? null : (params.get("annotation") ?? null),
    height: integerOf(params.get("height")),
    dest: !keyed && fragment.length > 0 ? decoded(fragment) : null,
    zoom: page === null ? (params.get("zoom") ?? null) : null,
    search: page === null ? (params.get("search") ?? null) : null,
    params,
  };
}
