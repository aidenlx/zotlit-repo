import { Layer } from "effect";

export interface GroupNode {
  readonly name: string;
  readonly provides: readonly string[];
  readonly requires: readonly string[];
}

export class CompositionError extends Error {
  override readonly name = "CompositionError";
}

export function buildOrder<G extends GroupNode>(
  groups: readonly G[],
  ambient: ReadonlySet<string> = new Set(),
): G[] {
  const filler = new Map<string, G>();
  for (const group of groups)
    for (const key of group.provides) {
      const other = filler.get(key);
      if (other)
        throw new CompositionError(
          `${key} is filled by both ${other.name} and ${group.name}`,
        );
      filler.set(key, group);
    }
  const needs = new Map<G, Set<G>>();
  for (const group of groups) {
    const below = new Set<G>();
    for (const key of group.requires) {
      if (ambient.has(key)) continue;
      const source = filler.get(key);
      if (!source)
        throw new CompositionError(
          `${group.name} reads ${key}, which no composed feature fills`,
        );
      if (source !== group) below.add(source);
    }
    needs.set(group, below);
  }
  const order: G[] = [];
  const placed = new Set<G>();
  while (order.length < groups.length) {
    const next = groups.find(
      (group) =>
        !placed.has(group) &&
        [...(needs.get(group) ?? [])].every((source) => placed.has(source)),
    );
    if (!next)
      throw new CompositionError(
        `These groups read each other in a cycle: ${groups
          .filter((group) => !placed.has(group))
          .map((group) => group.name)
          .join(", ")}`,
      );
    order.push(next);
    placed.add(next);
  }
  return order;
}

export function stackGroups(
  base: Layer.Layer<any>,
  groups: readonly Layer.Layer<any, never, any>[],
): Layer.Layer<any> {
  return groups.reduce<Layer.Layer<any>>(
    (below, group) => group.pipe(Layer.provideMerge(below)),
    base,
  );
}
