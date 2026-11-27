import type { Exit } from "effect";
import { Effect, Fiber, Layer, Option, Schema, Stream } from "effect";

import { Notifier, reportProgress } from "@zotlit/obsidian-kit/notifier.ts";
import type { NoticeHandle } from "@zotlit/obsidian-kit/notifier.ts";
import { logAndContinue } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type {
  LanguagePackInstallError,
  LanguagePackRestartNotice,
} from "./service.ts";
import { LanguagePack } from "./service.ts";

const RESTART_NOTICE_DURATION = "10 seconds";

class LanguagePackInstallCopy extends Schema.TaggedError<
  LanguagePackInstallCopy,
  { readonly brand: unique symbol }
>()("LanguagePackInstallCopy", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const failWithCopy = (message: string, cause: LanguagePackInstallError) =>
  Effect.fail(new LanguagePackInstallCopy({ message, cause }));

const downloadFailedCopy = (plugin: string, cause: LanguagePackInstallError) =>
  failWithCopy(
    m.notice_language_pack_download_failed({ plugin, message: cause.message }),
    cause,
  );

const reportInstall = (
  plugin: string,
  outcome: Effect.Effect<
    Exit.Exit<LanguagePackRestartNotice, LanguagePackInstallError>
  >,
) =>
  reportProgress(
    Effect.flatten(outcome).pipe(
      Effect.catchTag(
        "LanguagePackDownloadFailed",
        (error) =>
          error.updateNeeded
            ? failWithCopy(
                m.notice_language_pack_update_needed({ plugin }),
                error,
              )
            : downloadFailedCopy(plugin, error),
        (error) => downloadFailedCopy(plugin, error),
      ),
      Effect.exit,
    ),
    {
      loading: m.notice_language_pack_downloading({ plugin }),
      success: m.notice_language_pack_restart({ plugin }),
      error: (error) => (Error.isError(error) ? error.message : String(error)),
      successDuration: RESTART_NOTICE_DURATION,
    },
  );

export const toastLanguagePackInstall = Effect.gen(function* () {
  const pack = yield* LanguagePack;
  const install = yield* Effect.forkChild(pack.install);
  yield* reportInstall(pack.plugin, Fiber.await(install));
}).pipe(Effect.withSpan("LanguagePackNotices.toastInstall"));

export const layerLanguagePackNotices: Layer.Layer<
  never,
  never,
  LanguagePack | Notifier
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const pack = yield* LanguagePack;
    if (Option.isSome(pack.refresh)) {
      yield* Effect.forkScoped(reportInstall(pack.plugin, pack.refresh.value));
    } else if ((yield* pack.situation).kind === "offered") {
      yield* showInstallOffer;
    }
  }),
);

const showInstallOffer = Effect.gen(function* () {
  const pack = yield* LanguagePack;
  const notifier = yield* Notifier;
  const scope = yield* Effect.scope;
  const run = Effect.runForkWith(
    yield* Effect.context<LanguagePack | Notifier>(),
  );
  const notice: NoticeHandle = yield* notifier.show(
    {
      title: m.notice_language_pack_install({
        plugin: pack.plugin,
        language: pack.endonym,
      }),
      actions: [
        {
          label: m.notice_language_pack_decline_action(),
          run: () => {
            run(
              Effect.forkIn(
                pack.decline.pipe(
                  logAndContinue("Language Pack decline failed", "i18n"),
                ),
                scope,
              ),
            );
          },
        },
        {
          label: m.notice_language_pack_install_action(),
          run: () => {
            run(Effect.forkIn(toastLanguagePackInstall, scope));
          },
        },
      ],
    },
    { duration: 0 },
  );
  yield* Effect.addFinalizer(() => notice.hide);
  yield* pack.changes.pipe(
    Stream.filter((next) => next.kind !== "offered"),
    Stream.take(1),
    Stream.runDrain,
    Effect.andThen(notice.hide),
    Effect.forkScoped({ startImmediately: true }),
  );
});
