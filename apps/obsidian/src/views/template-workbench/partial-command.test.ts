// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Logger } from "effect";
import type { App } from "obsidian";
import { beforeEach, expect } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import {
  ButtonComponent,
  Modal,
  controlsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { Profile } from "@/services/profile/service.ts";
import { Template, templateFailure } from "@/services/template/service.ts";

import { createSharedPartialEffect } from "./partial-command.ts";

beforeEach(() => {
  Modal.instances.length = 0;
});

// A stopped create is silent; a write failure keeps its log and notice.
it.effect.each(["interrupt", "failure"] as const)(
  "reports a Shared Partial write stopped by %s",
  (reason) =>
    Effect.gen(function* () {
      const notifier = testNotifier();
      const errors: unknown[] = [];
      const app = stubService<App>("App", {});
      const flow = createSharedPartialEffect(app, {
        name: "authors",
        open: false,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(Template, {
              getPartialNames: Effect.succeed([]),
              createPartial: () =>
                reason === "interrupt"
                  ? Effect.interrupt
                  : Effect.fail(templateFailure(new Error("disk full"))),
            }),
            Layer.mock(Workspace, {}),
            Layer.mock(Vault, {}),
            Layer.mock(Profile, {}),
            Layer.succeed(Notifier, notifier.service),
            Logger.layer([
              Logger.make(({ logLevel, message }) => {
                if (logLevel === "Error") errors.push(message);
              }),
            ]),
          ),
        ),
      );
      const fiber = yield* Effect.forkChild(flow);
      yield* Effect.promise(async () => {
        await expect.poll(() => Modal.instances.length).toBe(1);
        const modal = Modal.instances[0]!;
        modal.onOpen();
        const create = controlsOf(
          modal.modalEl.querySelector<HTMLElement>(".modal-button-container")!,
        ).find(
          (control): control is ButtonComponent =>
            control instanceof ButtonComponent &&
            control.text === m.partial_new_action(),
        );
        expect(create).toBeInstanceOf(ButtonComponent);
        create!.click();
      });
      const exit = yield* Fiber.await(fiber);
      expect(Exit.hasInterrupts(exit)).toBe(reason === "interrupt");
      expect(Exit.isSuccess(exit) ? exit.value : "released").toBe(
        reason === "interrupt" ? "released" : null,
      );
      expect(errors).toHaveLength(reason === "failure" ? 1 : 0);
      expect(notifier.notices.map((notice) => notice.messages)).toEqual(
        reason === "failure" ? [[m.notice_partial_create_failed()]] : [],
      );
    }),
);
