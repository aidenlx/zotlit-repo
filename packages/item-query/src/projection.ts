import type { ItemQueryFault } from "./fault.ts";
import type {
  FieldDefinition,
  FieldNeeds,
  QueryItem,
  ValueShape,
} from "./fields.ts";
import { fieldDefinition } from "./fields.ts";
import type { PathSegment } from "./projection-path.ts";
import { parseProjectionPath } from "./projection-path.ts";
import type { ProjectionValue } from "./request.ts";

export interface PlannedPath<Item = QueryItem, Needs = FieldNeeds> {
  readonly text: string;
  readonly scalar: boolean;
  readonly shape: ValueShape;
  readonly each: number;
  readonly field: FieldDefinition<Item, Needs>;
  readonly rest: readonly PathSegment[];
  readonly needs: Needs;
  readonly customField: string | null;
}

export type PathProblem = Extract<
  ItemQueryFault,
  { kind: "plain" | "unknown" }
>;

export type PathResolver<Item = QueryItem, Needs = FieldNeeds> = (
  segments: readonly PathSegment[],
) =>
  | {
      readonly field: FieldDefinition<Item, Needs>;
      readonly rest: readonly PathSegment[];
    }
  | undefined;

export const resolveItemPath: PathResolver = ([root, ...rest]) => {
  const field = typeof root === "string" ? fieldDefinition(root) : undefined;
  return field && { field, rest };
};

export function planPath<Item = QueryItem, Needs = FieldNeeds>(
  text: string,
  resolve: PathResolver<Item, Needs>,
): PlannedPath<Item, Needs> | PathProblem {
  const parsed = parseProjectionPath(text);
  if (!parsed.ok) {
    return {
      kind: "plain",
      code: "invalid-path",
      action:
        'Write the path in the template accessor grammar, such as date.year or custom["review.status"].',
      at: { from: 0, to: text.length },
      message: `"${text}" is not a valid Projection Path. ${parsed.message}`,
    };
  }
  const resolved = resolve(parsed.segments);
  if (!resolved) {
    return {
      kind: "unknown",
      role: "projection-path",
      name: text,
      at: { from: 0, to: text.length },
    };
  }
  const { field, rest } = resolved;
  let shape: ValueShape = field.shape;
  let customField: string | null = null;
  for (const [index, segment] of rest.entries()) {
    const next = step(shape, segment);
    if (!next) {
      return {
        kind: "unknown",
        role: "projection-path",
        name: text,
        at: { from: 0, to: text.length },
        ...((typeof segment === "object" || shape.kind === "list") && {
          pathResolution: {
            found: shape.kind,
            expected: typeof segment === "object" ? "list" : "list-element",
            offset:
              parsed.offsets[parsed.segments.length - rest.length + index]!,
          },
        }),
      };
    }
    if (shape.kind === "custom-fields") {
      customField = segment as string;
    }
    shape = next;
  }
  const each = parsed.segments.filter(
    (segment) => typeof segment === "object",
  ).length;
  return {
    text,
    field,
    rest,
    needs: field.needs(rest),
    customField,
    scalar: shape.kind === "scalar" && each === 0,
    shape,
    each,
  };
}

export function canGroup(shape: ValueShape, each: number): boolean {
  return shape.kind === "scalar" && each <= 1;
}

function step(shape: ValueShape, segment: PathSegment): ValueShape | null {
  switch (shape.kind) {
    case "scalar":
    case "json":
      return null;
    case "record":
      return typeof segment === "string"
        ? (shape.vocabulary().field(segment)?.shape ?? null)
        : null;
    case "object":
      return typeof segment === "string" && Object.hasOwn(shape.keys, segment)
        ? shape.keys[segment]!
        : null;
    case "list":
      if (segment === "length") return { kind: "scalar", type: "number" };
      return typeof segment === "number" || typeof segment === "object"
        ? shape.element
        : null;
    case "custom-fields":
      return typeof segment === "string" ? shape.value : null;
  }
}

export function readPath<Item>(
  path: PlannedPath<Item, unknown>,
  item: Item,
): ProjectionValue {
  return path.field.project
    ? path.field.project(item, path.rest)
    : readSegments(path.field.read(item), path.rest);
}

export function readSegments(
  source: ProjectionValue,
  segments: readonly PathSegment[],
): ProjectionValue {
  let value = source;
  for (const [index, segment] of segments.entries()) {
    if (value === null || typeof value !== "object") return null;
    if (typeof segment === "object") {
      const rest = segments.slice(index + 1);
      return Array.isArray(value)
        ? value.map((element) => readSegments(element, rest))
        : null;
    }
    if (Array.isArray(value)) {
      if (segment === "length") return value.length;
      value = typeof segment === "number" ? (value[segment] ?? null) : null;
    } else if (typeof segment === "string" && Object.hasOwn(value, segment)) {
      value = (value as Record<string, ProjectionValue>)[segment] ?? null;
    } else {
      return null;
    }
  }
  return value;
}
