// The one Shared Partial create flow: the Workbench's entry points and the
// Add partial settings row both run it.

import type { CreateSharedPartialOptions } from "#obsidian/view/new-partial.ts";
import { Effect } from "effect";
import type { App } from "obsidian";

import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { withOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { openTemplateWorkbench } from "./open.ts";

import { openNewPartialPrompt } from "#obsidian/view/new-partial.ts";

/**
 * Ask a name under the shared rule and write `zotlit-partial.<name>.md`. An
 * interrupt closes the prompt. Where the document opens is the caller's.
 *
 * @returns the created document and its name, or `null` when the reader
 *   dismisses the prompt. Fails with the Template's failure.
 */
export const createSharedPartial = Effect.fn("SharedPartial.create")(function* (
  app: App,
  options: Omit<CreateSharedPartialOptions, "open" | "from"> = {},
) {
  const template = yield* Template;
  const taken = yield* template.getPartialNames;
  const name = yield* awaitModal<string | null>((settle) =>
    openNewPartialPrompt(app, { taken, seed: options.name }, settle),
  );
  if (name === null) return null;
  const file = yield* template.createPartial(name, {
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.language === undefined ? {} : { language: options.language }),
  });
  return { name, file };
});

/**
 * {@link createSharedPartial} for a Workbench entry point, which a leaf runs
 * on its runner, so closing the leaf also closes its prompt. The document opens
 * as `options.open` says. A failure is logged and shows a notice, and answers
 * `null` as a dismissal does.
 *
 * @returns the created name, or `null`.
 */
export const createSharedPartialEffect = Effect.fn(
  "TemplateWorkbench.createSharedPartial",
)(function* (app: App, options: CreateSharedPartialOptions = {}) {
  return yield* withOutcome(
    Effect.gen(function* () {
      const { open = "split", from, ...create } = options;
      const created = yield* createSharedPartial(app, create);
      if (!created) return null;
      if (open !== false)
        yield* openTemplateWorkbench(created.file, {
          explainUnsupported: false,
          ...(from ? { from: { leaf: from, place: open } } : {}),
        });
      return created.name;
    }),
    {
      success: () => undefined,
      error: () => m.notice_partial_create_failed(),
    },
  ).pipe(recover(() => Effect.void, Effect.succeed(null)));
}, withLogCategory("template-workbench"));
