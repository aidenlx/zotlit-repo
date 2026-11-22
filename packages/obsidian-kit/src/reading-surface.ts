import { Effect } from "effect";

import type { WorkspaceShape } from "./obsidian-workspace.ts";
import { rerenderReadingViews } from "./reading-view.ts";

export const rerenderReadingViewsIn = Effect.fn("rerenderReadingViewsIn")(
  function* (workspace: Pick<WorkspaceShape, "markdownViews">) {
    const count = rerenderReadingViews(yield* workspace.markdownViews);
    yield* Effect.logDebug("Rerendering reading views").pipe(
      Effect.annotateLogs({ count }),
    );
  },
);

export const retireReadingSurface = (
  workspace: Pick<WorkspaceShape, "markdownViews">,
  retire: () => void,
) =>
  Effect.addFinalizer(() =>
    Effect.suspend(() => {
      retire();
      return rerenderReadingViewsIn(workspace);
    }),
  );
