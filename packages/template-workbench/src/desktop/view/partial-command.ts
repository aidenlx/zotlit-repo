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

export const createSharedPartialEffect = Effect.fn(
  "TemplateWorkbench.createSharedPartial",
)(function* (app: App, options: CreateSharedPartialOptions = {}) {
  return yield* withOutcome(
    Effect.gen(function* () {
      const { open = "split", from, ...create } = options;
      const created = yield* createSharedPartial(app, create);
      if (!created) return null;
      if (open !== false)
        yield* openTemplateWorkbench(
          created.file,
          from ? { from: { leaf: from, place: open } } : {},
        );
      return created.name;
    }),
    {
      success: () => undefined,
      error: () => m.notice_partial_create_failed(),
    },
  ).pipe(recover(() => Effect.void, Effect.succeed(null)));
}, withLogCategory("template-workbench"));
