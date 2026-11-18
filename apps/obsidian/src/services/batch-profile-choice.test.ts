// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Deferred, Effect, Layer } from "effect";
import { SuggestModal } from "obsidian";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { awaitModal } from "@zotlit/obsidian-kit/effect-modal.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import { unimplementedProfileDialogServices } from "@/setting-tab/__fixtures__.ts";

import { chooseBatchProfile } from "./batch-profile-choice.ts";
import { interruptedWithin } from "./note-feature/__fixtures__/interrupt.ts";

/** The batch choice's services: no Zotero data folder. */
function services() {
  return {
    layer: Layer.mergeAll(
      unimplementedProfileDialogServices,
      testNotifier().layer,
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
    ),
  };
}

const app = stubService<App>("App", {
  keymap: stubService<App["keymap"]>("Keymap", {
    pushScope: vi.fn(),
    popScope: vi.fn(),
  }),
});

/** Answer the open picker with its New profile row or its Import button. */
const answerPicker = Effect.fnUntraced(function* (
  modal: SuggestModal<unknown>,
  action: "new" | "import",
) {
  const rows = yield* Effect.promise(async () => modal.getSuggestions(""));
  const last = rows.at(-1)!;
  if (action === "new") {
    modal.onChooseSuggestion(last, new KeyboardEvent("keydown"));
    return;
  }
  const el = document.createElement("div");
  modal.renderSuggestion(last, el);
  el.querySelector("button")!.click();
});

it.effect.each(["new", "import"] as const)(
  "closes the %s Profile dialog the batch picker opened when the choice is interrupted",
  (action) =>
    Effect.gen(function* () {
      using opened = vi.spyOn(SuggestModal.prototype, "open");
      const dialogOpened = yield* Deferred.make<void>();
      const close = vi.fn();
      // The dialog stays open until something closes it.
      const dialog = awaitModal<undefined>(() => {
        Deferred.doneUnsafe(dialogOpened, Effect.void);
        return { close };
      });
      const harness = services();
      const choice = yield* chooseBatchProfile(
        { app, createProfile: () => dialog, importProfile: () => dialog },
        {
          selection: { selector: "default", source: "bound", shouldAsk: true },
          previews: [],
        },
      ).pipe(
        Effect.provide(harness.layer),
        Effect.forkDetach({ startImmediately: true }),
      );
      yield* Effect.yieldNow;
      const picker = opened.mock.instances[0];
      if (!(picker instanceof SuggestModal))
        return yield* Effect.die("the picker did not open");
      yield* answerPicker(picker, action);
      yield* Deferred.await(dialogOpened);
      expect(yield* interruptedWithin(choice)).toBe(true);
      expect(close).toHaveBeenCalledOnce();
    }),
);
