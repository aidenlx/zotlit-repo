// Show in Library as one tag, so a view, a popover or a command opens the
// Library View on an Item without holding the Obsidian App. The Library View
// provides the layer; the features that open it read the tag, and a view reads
// it through `showInLibraryCommand`.
import { Context, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { viewRuntime } from "./view-atoms.ts";

export class ShowInLibrary extends Context.Service<
  ShowInLibrary,
  {
    /**
     * Open the Library View on the Item `indexedKey`, selected in its first
     * Collection; a notice tells the researcher when the row is not listed.
     */
    show(indexedKey: string): Effect.Effect<void>;
  }
>()("zotlit/library-view/ShowInLibrary") {}

declare module "./view-atoms.ts" {
  interface ViewServiceRegistry {
    ShowInLibrary: ShowInLibrary;
  }
}

/** The Library View can open after the pane that asked for it closes. */
export const showInLibraryCommand = Atom.keepAlive(
  viewRuntime.fn(
    (indexedKey: string) =>
      Effect.gen(function* () {
        yield* (yield* ShowInLibrary).show(indexedKey);
      }),
    { concurrent: true },
  ),
);
