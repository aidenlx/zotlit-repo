import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";

export interface LibrarySelection {
  readonly key: string | null;
}
export const makeLibraryModel = () => ({
  selection: Atom.make<LibrarySelection>({ key: null }),
});
export const patchSelection =
  (patch: Partial<LibrarySelection>) =>
  (state: LibrarySelection): LibrarySelection =>
    Object.entries(patch).every(
      ([key, value]) => state[key as keyof LibrarySelection] === value,
    )
      ? state
      : { ...state, ...patch };

export function waitForRead<A, E>(
  registry: ViewRegistryHandle,
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
  releases: Set<() => void>,
): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      off();
      releases.delete(finish);
      resolve();
    };
    const off = registry.subscribe(atom, (result) => {
      if (!AsyncResult.isInitial(result) && !result.waiting) finish();
    });
    releases.add(finish);
    const current = registry.get(atom);
    if (!AsyncResult.isInitial(current) && !current.waiting) finish();
  });
}
