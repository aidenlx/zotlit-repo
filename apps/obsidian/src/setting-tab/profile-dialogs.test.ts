import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer } from "effect";
import type { App } from "obsidian";
import { expect, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import {
  ButtonComponent,
  Modal,
  controlsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import type { ProfileId } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { until } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import { UserCancelled } from "@zotlit/plugin-kernel/user-cancel.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { NoteFeature } from "@/services/note-feature/service.ts";
import { profileReader } from "@/services/profile/__fixtures__/reader.ts";
import { profileServiceFixture } from "@/services/profile/__fixtures__/service.ts";
import { Profile } from "@/services/profile/service.ts";
import type { LiteratureNoteProfile } from "@/services/profile/service.ts";
import { Template } from "@/services/template/service.ts";

import { ProfileDestinationModal } from "./profile-destination-modal.ts";
import { addProfileDestination, shareProfile } from "./profile-dialogs.ts";
import { ShareProfileModal } from "./share-profile-modal.ts";

const BOOKS: LiteratureNoteProfile = {
  id: "Bk3Qn7XvT2Lp" as ProfileId,
  label: "Books",
  document: "zotlit-profile.books.md",
  path: "templates/zotlit-profile.books.md",
  bindings: {},
  match: { state: "absent", summary: m.profile_match_absent() },
};

/** A spy that the case's Scope restores. */
const spy = <A extends Disposable>(acquire: () => A) =>
  Effect.acquireDisposable(Effect.sync(acquire));

/** The footer button labelled `label`. */
function footerButton(modal: Modal, label: string): ButtonComponent {
  const footer = modal.modalEl.querySelector<HTMLElement>(
    ".modal-button-container",
  )!;
  const button = controlsOf(footer).find(
    (control): control is ButtonComponent =>
      control instanceof ButtonComponent && control.text === label,
  );
  if (!button) throw new Error(`No ${label} button`);
  return button;
}

it.effect(
  "closes Add profile when its Scope ends during the save, and the started write finishes",
  () =>
    Effect.gen(function* () {
      const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
      const gate = yield* Deferred.make<void>();
      let written = false;
      // The Profile service owns the write: it runs on, and the dialog joins it.
      const write = yield* Effect.forkChild(
        Deferred.await(gate).pipe(
          Effect.andThen(
            Effect.sync(() => {
              written = true;
              return BOOKS;
            }),
          ),
        ),
      );
      let started = false;
      const reader = profileReader();
      const services = Layer.mergeAll(
        Layer.mock(Profile, {
          resolveProfile: () =>
            Effect.succeed(reader.resolveProfile("default")),
          prepareCreate: () =>
            Effect.succeed({
              profile: reader.resolveProfile("default")!,
              source: "",
              inherited: [],
              create: () =>
                Effect.suspend(() => {
                  started = true;
                  return Fiber.join(write);
                }),
            }),
        }),
        Layer.mock(Template, {}),
        Layer.mock(NoteFeature, {}),
        Layer.mock(Vault, {}),
        Layer.mock(Workspace, {}),
        Layer.succeed(
          PluginHost,
          stubService<PluginHost["Service"]>("PluginHost", {}),
        ),
        testNotifier().layer,
      );
      const pending = yield* addProfileDestination(
        stubService<App>("App", {}),
      ).pipe(
        Effect.provide(services),
        Effect.forkChild({ startImmediately: true }),
      );
      yield* until(() => opened.mock.calls.length === 1);
      const modal = Modal.instances.at(-1)!;
      expect(modal).toBeInstanceOf(ProfileDestinationModal);
      modal.onOpen();
      const add = footerButton(modal, m.settings_profile_add());
      yield* until(() => {
        add.click();
        return started;
      });
      yield* Fiber.interrupt(pending);
      expect(modal.isOpen).toBe(false);
      expect(written).toBe(false);
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(write)).toBe(BOOKS);
      expect(written).toBe(true);
    }),
);

it.effect("keeps Share open until it closes, and an interrupt closes it", () =>
  Effect.gen(function* () {
    const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
    const f = yield* Effect.acquireDisposable(
      Effect.promise(() => profileServiceFixture()),
    );
    const services = yield* Effect.promise(() => f.runtime.context());
    const pending = yield* shareProfile(f.app, "default").pipe(
      Effect.provideContext(services),
      Effect.provide(Layer.merge(testNotifier().layer, NodeFileSystem.layer)),
      Effect.forkChild({ startImmediately: true }),
    );
    yield* until(() => opened.mock.calls.length === 1);
    const modal = Modal.instances.at(-1)!;
    expect(modal).toBeInstanceOf(ShareProfileModal);
    yield* Fiber.interrupt(pending);
    expect(modal.isOpen).toBe(false);
  }),
);

/**
 * Add profile with its save started and never done, and the reason the
 * dialog's save rejects with, as the modal tests it.
 */
const savingDestination = Effect.gen(function* () {
  const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
  const tested = yield* spy(() => vi.spyOn(AbortError, "test"));
  let started = false;
  const reader = profileReader();
  const services = Layer.mergeAll(
    Layer.mock(Profile, {
      resolveProfile: () => Effect.succeed(reader.resolveProfile("default")),
      prepareCreate: () =>
        Effect.succeed({
          profile: reader.resolveProfile("default")!,
          source: "",
          inherited: [],
          create: () =>
            Effect.suspend(() => {
              started = true;
              return Effect.never;
            }),
        }),
    }),
    Layer.mock(Template, {}),
    Layer.mock(NoteFeature, {}),
    Layer.mock(Vault, {}),
    Layer.mock(Workspace, {}),
    Layer.succeed(
      PluginHost,
      stubService<PluginHost["Service"]>("PluginHost", {}),
    ),
    testNotifier().layer,
  );
  const pending = yield* addProfileDestination(
    stubService<App>("App", {}),
  ).pipe(
    Effect.provide(services),
    Effect.forkChild({ startImmediately: true }),
  );
  yield* until(() => opened.mock.calls.length === 1);
  const modal = Modal.instances.at(-1)!;
  modal.onOpen();
  const add = footerButton(modal, m.settings_profile_add());
  yield* until(() => {
    add.click();
    return started;
  });
  return {
    pending,
    modal,
    /** What the save's rejection was, once the modal's catch tests it. */
    reason: Effect.gen(function* () {
      yield* until(() => tested.mock.calls.length > 0);
      return tested.mock.calls[0]![0];
    }),
  };
});

// The user's close stops the work it started with a typed reason.
it.effect(
  "stops the save with UserCancelled when the user closes Add profile",
  () =>
    Effect.gen(function* () {
      const dialog = yield* savingDestination;
      dialog.modal.close();
      dialog.modal.onClose();
      expect(yield* Fiber.join(dialog.pending)).toBeUndefined();
      expect(yield* dialog.reason).toBeInstanceOf(UserCancelled);
    }),
);

it.effect(
  "stops the save with an AbortError when unload closes Add profile",
  () =>
    Effect.gen(function* () {
      const dialog = yield* savingDestination;
      yield* Fiber.interrupt(dialog.pending);
      expect(dialog.modal.isOpen).toBe(false);
      const reason = yield* dialog.reason;
      expect(AbortError.test(reason)).toBe(true);
      expect(reason).not.toBeInstanceOf(UserCancelled);
    }),
);
