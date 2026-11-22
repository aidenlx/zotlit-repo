import { Effect, Schema } from "effect";
import type { TFile } from "obsidian";

import { vaultError } from "@zotlit/plugin-kernel/vault-errors.ts";

import { setViewDataKeepingScroll } from "#live-text.ts";
import { Vault } from "#obsidian-vault.ts";
import { Workspace } from "#obsidian-workspace.ts";

export class LiveTextRewriteFailed extends Schema.TaggedError<
  LiveTextRewriteFailed,
  { readonly brand: unique symbol }
>()("LiveTextRewriteFailed", {
  path: Schema.String,
  cause: Schema.Defect(),
}) {}

export const readLiveText = Effect.fnUntraced(function* (file: TFile) {
  const view = yield* (yield* Workspace).loadedTextView(file);
  if (view !== null) return view.getViewData();
  return yield* (yield* Vault).cachedRead(file);
});

export const processLiveText = Effect.fn("processLiveText")(function* (
  file: TFile,
  fn: (text: string) => string,
) {
  const failed = (cause: unknown) =>
    new LiveTextRewriteFailed({ path: file.path, cause });
  const view = yield* (yield* Workspace).loadedTextView(file);
  if (view !== null) {
    const text = view.getViewData();
    const next = yield* Effect.try({ try: () => fn(text), catch: failed });
    if (next === text) return;
    setViewDataKeepingScroll(view, next);
    if (view.getViewData() === next) {
      yield* Effect.tryPromise({
        try: () => view.save(),
        catch: vaultError("save", file.path),
      });
      return;
    }
    setViewDataKeepingScroll(view, text);
  }
  yield* (yield* Vault)
    .process(file, (text) => {
      try {
        return fn(text);
      } catch (cause) {
        throw failed(cause);
      }
    })
    .pipe(
      Effect.catchTag("VaultError", (error) =>
        Effect.fail(
          error.cause instanceof LiveTextRewriteFailed ? error.cause : error,
        ),
      ),
    );
});
