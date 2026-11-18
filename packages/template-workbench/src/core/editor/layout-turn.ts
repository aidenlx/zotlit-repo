// The workspace's layout turn, which every Template Workbench surface that
// adds a leaf takes: the Template Workbench View and the Template Data
// Explorer.
import { Semaphore } from "effect";
import type { Effect } from "effect";

/**
 * One layout open at a time in the workspace, so a later open sees the leaves
 * an earlier one made. An open that fails or stops frees the turn.
 */
const layoutTurn = Semaphore.makeUnsafe(1);
/**
 * `effect` in the workspace's layout turn, for an open that adds a leaf: two
 * opens at once add one.
 */
export const inLayoutTurn = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  layoutTurn.withPermit(effect);
