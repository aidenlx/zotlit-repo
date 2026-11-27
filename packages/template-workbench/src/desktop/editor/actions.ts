import type { Context } from "effect";
import { Effect } from "effect";

import type { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Notifier, reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notifier.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export const templateWorkbenchAction = <A, E, R>(
  operation: string,
  action: Effect.Effect<A, E, R>,
) =>
  reportOutcome(action, {
    success: () => undefined,
    error: () => m.notice_profile_action_failed(),
  }).pipe(
    Effect.annotateLogs({ operation }),
    withLogCategory("template-workbench"),
  );

export interface WorkbenchOpened {
  readonly unavailableNote: string | null;
}

export const explainWorkbenchOpen = Effect.fn(
  "TemplateWorkbench.explainWorkbenchOpen",
)(function* (opened: WorkbenchOpened | void) {
  if (!opened) return;
  const notifier = yield* Notifier;
  if (opened.unavailableNote !== null)
    yield* notifier.show(
      m.template_workbench_update_unavailable({
        name: opened.unavailableNote,
      }),
    );
});

export type WorkbenchActionServices = Notifier | Vault | Workspace | Profile;

export const explainNoOpen = Effect.fn("TemplateWorkbench.explainNoOpen")(
  function* (message: NoticeMessage) {
    yield* (yield* Notifier).show(message);
  },
);

export interface WorkbenchActionDeps {
  readonly bridge: Pick<EffectBridge, "runAndForget">;
  readonly context: Context.Context<WorkbenchActionServices>;
}

export function startTemplateWorkbenchAction<E>(
  deps: WorkbenchActionDeps,
  operation: string,
  open: Effect.Effect<WorkbenchOpened | void, E, WorkbenchActionServices>,
): void {
  deps.bridge.runAndForget(
    templateWorkbenchAction(
      operation,
      open.pipe(Effect.flatMap((opened) => explainWorkbenchOpen(opened))),
    ).pipe(Effect.provideContext(deps.context)),
  );
}
