// The order the plugin graph builds its service groups in, derived from the
// tags each group fills and reads, and the Layer that builds them in it.
import { Layer } from "effect";

/** What the derivation reads of a service group: its name and its tag keys. */
export interface GroupNode {
  readonly name: string;
  /** The keys of the tags the group fills. */
  readonly provides: readonly string[];
  /** The keys of the tags the group reads that another group fills. */
  readonly requires: readonly string[];
}

/** A composition the shell cannot build: a tag with no filler, two fillers, or a cycle. */
export class CompositionError extends Error {
  override readonly name = "CompositionError";
}

/**
 * The groups in build order: each group after every group that fills a tag it
 * reads. Among the groups that are free to build, the one declared first
 * builds first, so the order follows the host's feature list wherever the
 * tags allow it. `ambient` holds the keys the shell's base fills, which every
 * group may read.
 *
 * @throws {CompositionError} when a tag a group reads has no filler, when two
 *   groups fill one tag, or when the groups read each other in a cycle.
 */
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

/**
 * One Layer that builds `groups` above `base`, one after the other, in the
 * order given. Each group reads every service built below it; the graph
 * closes in reverse, so a group closes before what it reads.
 */
export function stackGroups(
  base: Layer.Layer<any>,
  groups: readonly Layer.Layer<any, never, any>[],
): Layer.Layer<any> {
  return groups.reduce<Layer.Layer<any>>(
    (below, group) => group.pipe(Layer.provideMerge(below)),
    base,
  );
}
