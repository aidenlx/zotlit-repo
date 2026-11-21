// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Logger, References } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { LegacyPortError, portCall } from "@zotlit/obsidian-kit/legacy-port.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { explainWorkbenchOpen, templateWorkbenchAction } from "./actions.ts";

/** The notices and error logs one action leaves. */
function recorder() {
  const notifier = testNotifier();
  const errors: unknown[] = [];
  return {
    notices: () => notifier.notices.map((notice) => notice.messages),
    errors,
    layer: Layer.merge(
      Layer.succeed(Notifier, notifier.service),
      Logger.layer([
        Logger.make(({ logLevel, fiber }) => {
          if (logLevel === "Error")
            errors.push(fiber.getRef(References.CurrentLogAnnotations));
        }),
      ]),
    ),
  };
}

it.effect("shows nothing when the action succeeds", () =>
  Effect.gen(function* () {
    const record = recorder();
    yield* templateWorkbenchAction("open-editor", Effect.void).pipe(
      Effect.provide(record.layer),
    );
    expect(record.notices()).toEqual([]);
    expect(record.errors).toEqual([]);
  }),
);

it.effect("logs a failed action under its operation and shows a notice", () =>
  Effect.gen(function* () {
    const record = recorder();
    yield* templateWorkbenchAction(
      "open-editor",
      Effect.fail(new LegacyPortError({ step: "open", cause: "disk full" })),
    ).pipe(Effect.provide(record.layer));
    expect(record.notices()).toEqual([[m.notice_profile_action_failed()]]);
    expect(record.errors).toMatchObject([{ operation: "open-editor" }]);
  }),
);

// An unpack or restore that unload stops is released quietly. A port
// that unload stopped rejects with an abort, which passes on as an
// interrupt.
it.effect.each(["interrupt", "abort"] as const)(
  "releases an action stopped by %s without a notice or an error log",
  (reason) =>
    Effect.gen(function* () {
      const record = recorder();
      const fiber = yield* templateWorkbenchAction(
        "unpack-partials",
        reason === "interrupt"
          ? Effect.never
          : portCall("unpack", () => Promise.reject(new AbortError())),
      ).pipe(Effect.provide(record.layer), Effect.forkChild);
      yield* Effect.yieldNow;
      if (reason === "interrupt") yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(record.notices()).toEqual([]);
      expect(record.errors).toEqual([]);
    }),
);

it.effect("explains what an open asks the reader to know", () =>
  Effect.gen(function* () {
    const record = recorder();
    yield* explainWorkbenchOpen({ unavailableNote: "Original" }).pipe(
      Effect.provide(record.layer),
    );
    yield* explainWorkbenchOpen({ unavailableNote: null }).pipe(
      Effect.provide(record.layer),
    );
    expect(record.notices()).toEqual([
      [m.template_workbench_update_unavailable({ name: "Original" })],
    ]);
  }),
);
