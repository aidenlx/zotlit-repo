import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { it as effectIt } from "@effect/vitest";
import { Effect, Fiber, Layer } from "effect";
// @vitest-environment happy-dom
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, vi } from "vitest";

import * as nativeDialog from "@zotlit/obsidian-desktop/require.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import {
  ButtonComponent,
  Modal,
  TextComponent,
  ToggleComponent,
  settingsOf,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type {
  ProfileId,
  ProfileSelector,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import { until } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { TemplateFacade } from "@zotlit/templates/facade";

import type { Profile, ProfileShareOptions } from "./service.ts";
import { ShareProfileModal } from "./share-profile-modal.ts";
import type { ShareOutput } from "./share-profile-modal.ts";

import { profileServiceFixture } from "#__fixtures__/profile/service.ts";
import { shareProfile } from "#desktop/profile/dialogs.ts";

const id = "Bk3Qn7XvT2Lp" as ProfileId;
const source = `---
id: ${id}
name: Books
version: 1.2.3
contract: 2
filename: "{{ zt.title }}"
author: First author
description: Reading notes
folder: Books
importFolder: Imported
---
{% managed %}{% render "summary" %}{% endmanaged %}
--- zotlit:annotation ---\nAnnotation`;

function dialogWith(
  showSaveDialog: ReturnType<
    typeof nativeDialog.requireDialog
  >["showSaveDialog"],
): ReturnType<typeof nativeDialog.requireDialog> {
  return stubService<ReturnType<typeof nativeDialog.requireDialog>>("Dialog", {
    showSaveDialog,
  });
}

function recordedOutput() {
  const share = vi.fn<ShareOutput>(async () => {});
  return Object.assign(share, {
    sent: (destination: "clipboard" | "file") =>
      share.mock.calls
        .filter(([to]) => to === destination)
        .map(([, source]) => source),
  });
}

const sharePlan = Effect.fnUntraced(function* (
  profile: Profile["Service"],
  selector: ProfileSelector,
) {
  const plan = yield* profile.prepareShare(selector);
  const runSync = Effect.runSyncWith(yield* Effect.context<never>());
  return {
    ...plan,
    render: (options: ProfileShareOptions) => runSync(plan.render(options)),
  };
});

function observeControls(container: HTMLElement) {
  using stack = new DisposableStack();
  const labels = stack.use(
    vi.spyOn(ButtonComponent.prototype, "setButtonText"),
  );
  const clicks = stack.use(vi.spyOn(ButtonComponent.prototype, "onClick"));
  const cleanup = stack.move();
  return {
    type(label: string, value: string) {
      const row = settingsOf(container).find(({ name }) => name === label)!;
      row.components
        .find((control) => control instanceof TextComponent)!
        .type(value);
    },
    toggle(label: string) {
      const row = settingsOf(container).find(({ name }) => name === label)!;
      return row.components.find(
        (control) => control instanceof ToggleComponent,
      )!;
    },
    click(label: string) {
      const instance =
        labels.mock.instances[
          labels.mock.calls.findIndex(([text]) => text === label)
        ];
      return clicks.mock.calls[clicks.mock.instances.indexOf(instance)]![0](
        {} as MouseEvent,
      );
    },
    [Symbol.dispose]: () => cleanup.dispose(),
  };
}

effectIt.effect(
  "edits share metadata, bumps the version, and hands both destinations the same bundle without changing the vault",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": source,
            "templates/zotlit-partial.summary.md": "Shared summary",
          }),
        ),
      );
      const before = new Map(f.vault.contents);
      const share = recordedOutput();
      const modal = new ShareProfileModal(
        f.app,
        yield* sharePlan(f.profileService, id),
        share,
      );
      modal.contentEl = document.createElement("div");
      using controls = observeControls(modal.contentEl);
      modal.onOpen();
      expect(controls.toggle(m.profile_share_folders()).getValue()).toBe(false);
      expect(controls.toggle("summary").getValue()).toBe(true);
      controls.click(m.profile_share_bump());
      controls.type(m.profile_share_author(), "Research group");
      controls.type(m.profile_share_description(), "Revised notes");
      yield* Effect.promise(async () => controls.click(m.profile_share_copy()));
      const output = share.sent("clipboard")[0]!;
      const parsed = new TemplateFacade().parseLiteratureNoteTemplate(output);
      expect(parsed.manifest).toMatchObject({
        id,
        version: "1.2.4",
        author: "Research group",
        description: "Revised notes",
        partials: [{ name: "summary", source: "Shared summary" }],
      });
      expect(parsed.manifest.folder).toBeUndefined();
      expect(parsed.manifest.importFolder).toBeUndefined();
      yield* Effect.promise(async () => controls.click(m.profile_share_save()));
      expect(share.sent("file")).toEqual([output]);
      controls.toggle(m.profile_share_folders()).toggle(true);
      yield* Effect.promise(async () => controls.click(m.profile_share_copy()));
      expect(
        new TemplateFacade().parseLiteratureNoteTemplate(
          share.sent("clipboard")[1]!,
        ).manifest,
      ).toMatchObject({
        folder: "Books",
        importFolder: "Imported",
      });
      expect(f.vault.contents).toEqual(before);
      modal.onClose();
    }),
);

effectIt.effect(
  "keeps an empty version inline and hands nothing over until it is valid",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() => profileServiceFixture()),
      );
      const share = recordedOutput();
      const modal = new ShareProfileModal(
        f.app,
        yield* sharePlan(f.profileService, "default"),
        share,
      );
      modal.contentEl = document.createElement("div");
      using controls = observeControls(modal.contentEl);
      modal.onOpen();
      controls.type(m.profile_share_version(), "");
      expect(modal.contentEl.textContent).toContain(
        m.profile_share_version_required(),
      );
      yield* Effect.promise(async () => controls.click(m.profile_share_copy()));
      expect(share).not.toHaveBeenCalled();
      controls.type(m.profile_share_version(), "1.0.0");
      yield* Effect.promise(async () => controls.click(m.profile_share_save()));
      expect(share).toHaveBeenCalledOnce();
      expect(f.vault.contents.size).toBe(0);
      modal.onClose();
    }),
);

effectIt.effect.each([true, false])(
  "shares the checkbox choice as exact text with includeMatch=%s",
  (includeMatch) =>
    Effect.gen(function* () {
      const prefix = `---
# Keep sender formatting
id: Bk3Qn7XvT2Lp
name: 'Books'
version: 1.0.0
contract: 2
filename: '{{ zt.title }}'
folder: Books
importFolder: Imported
citationStyle: null
importColoredHighlights: false
importAnnotationsAsTemplate: false
`;
      const match = `match: 'collections.within("Unknown/Reading")'\n`;
      const suffix = `---
{% managed %}Body{% endmanaged %}
--- zotlit:annotation ---
Annotation`;
      const original = prefix + match + suffix;
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": original,
          }),
        ),
      );
      const share = recordedOutput();
      const modal = new ShareProfileModal(
        f.app,
        yield* sharePlan(f.profileService, id),
        share,
      );
      modal.contentEl = document.createElement("div");
      using controls = observeControls(modal.contentEl);
      modal.onOpen();
      expect(controls.toggle(m.profile_share_include_match()).getValue()).toBe(
        true,
      );
      controls.toggle(m.profile_share_folders()).toggle(true);
      if (!includeMatch)
        controls.toggle(m.profile_share_include_match()).toggle(false);
      yield* Effect.promise(async () => controls.click(m.profile_share_copy()));
      yield* Effect.promise(async () => controls.click(m.profile_share_save()));
      const expected = prefix + (includeMatch ? match : "") + suffix;
      expect(share.sent("clipboard")).toEqual([expected]);
      expect(share.sent("file")).toEqual([expected]);
      expect(f.vault.contents.get("templates/zotlit-profile.books.md")).toBe(
        original,
      );
      modal.onClose();
    }),
);

effectIt.effect(
  "checks the partials the profile calls, and drops one the reader clears",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": source.replace(
              '{% render "summary" %}',
              '{% render "authors" %}',
            ),
            "templates/zotlit-partial.authors.md": "{{ zt.creators }}",
            "templates/zotlit-partial.venue-line.md":
              "{{ zt.publicationTitle }}",
          }),
        ),
      );
      const share = recordedOutput();
      const modal = new ShareProfileModal(
        f.app,
        yield* sharePlan(f.profileService, id),
        share,
      );
      modal.contentEl = document.createElement("div");
      using controls = observeControls(modal.contentEl);
      modal.onOpen();
      expect(controls.toggle("authors").getValue()).toBe(true);
      expect(controls.toggle("venue-line").getValue()).toBe(false);

      controls.toggle("venue-line").toggle(true);
      yield* Effect.promise(async () => controls.click(m.profile_share_copy()));
      expect(
        new TemplateFacade()
          .parseLiteratureNoteTemplate(share.sent("clipboard")[0]!)
          .manifest.partials?.map(({ name }) => name),
      ).toEqual(["authors", "venue-line"]);

      controls.toggle("venue-line").toggle(false);
      controls.toggle("authors").toggle(false);
      yield* Effect.promise(async () => controls.click(m.profile_share_copy()));
      expect(
        new TemplateFacade().parseLiteratureNoteTemplate(
          share.sent("clipboard")[1]!,
        ).manifest.partials,
      ).toBeUndefined();
      modal.onClose();
    }),
);

effectIt.effect(
  "shares after missing-partial recovery creates an empty document",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": source,
            "templates/zotlit-partial.summary.md": "",
          }),
        ),
      );

      const plan = yield* sharePlan(f.profileService, id);
      const shared = new TemplateFacade().parseLiteratureNoteTemplate(
        plan.render({
          version: "1.2.3",
          author: "",
          description: "",
          partials: ["summary"],
        }),
      );

      expect(shared.manifest.partials).toEqual([
        { name: "summary", language: "liquid", source: "" },
      ]);
    }),
);

effectIt.effect(
  "opens for a profile whose call no document answers, and names it",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.acquireDisposable(
        Effect.promise(() =>
          profileServiceFixture({
            "templates/zotlit-profile.books.md": source,
            "templates/zotlit-partial.venue-line.md":
              "{{ zt.publicationTitle }}",
          }),
        ),
      );
      const plan = yield* sharePlan(f.profileService, id);

      expect(plan.missing).toEqual(["summary"]);
      expect(plan.reachable).toEqual([]);
      expect(plan.partials).toEqual(["venue-line"]);

      const modal = new ShareProfileModal(f.app, plan, recordedOutput());
      modal.contentEl = document.createElement("div");
      using controls = observeControls(modal.contentEl);
      modal.onOpen();

      expect(modal.contentEl.textContent).toContain(
        m.profile_share_missing_partials({ names: "summary" }),
      );
      expect(controls.toggle("venue-line").getValue()).toBe(false);
      modal.onClose();
    }),
);

const sharing = Effect.fnUntraced(function* (
  answer: (
    folder: string,
  ) => Promise<{ canceled: boolean; filePath: string }> = async () => ({
    canceled: true,
    filePath: "",
  }),
) {
  const f = yield* Effect.acquireDisposable(
    Effect.promise(() =>
      profileServiceFixture({
        "templates/zotlit-profile.books.md": source,
        "templates/zotlit-partial.summary.md": "Shared summary",
      }),
    ),
  );
  const folder = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "zotlit-share-"))),
    (folder) =>
      Effect.promise(() => rm(folder, { recursive: true, force: true })),
  );
  const spy = <A extends Disposable>(acquire: () => A) =>
    Effect.acquireDisposable(Effect.sync(acquire));
  const clipboard = yield* spy(() =>
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(),
  );
  const showSaveDialog = vi.fn(() => answer(folder));
  yield* spy(() =>
    vi
      .spyOn(nativeDialog, "requireDialog")
      .mockReturnValue(dialogWith(showSaveDialog)),
  );
  const opened = yield* spy(() => vi.spyOn(Modal.prototype, "open"));
  const services = yield* Effect.promise(() => f.runtime.context());
  const pending = yield* shareProfile(f.app, id).pipe(
    Effect.provideContext(services),
    Effect.provide(Layer.merge(testNotifier().layer, NodeFileSystem.layer)),
    Effect.forkChild({ startImmediately: true }),
  );
  yield* until(() => opened.mock.calls.length === 1);
  const modal = Modal.instances.at(-1)!;
  expect(modal).toBeInstanceOf(ShareProfileModal);
  const controls = yield* spy(() => observeControls(modal.contentEl));
  modal.onOpen();
  return {
    modal,
    controls,
    pending,
    clipboard,
    showSaveDialog,
    folder,
  };
});

const press = (
  s: { controls: ReturnType<typeof observeControls> },
  label: string,
) => Effect.sync(() => void s.controls.click(label));

const output = (
  s: { controls: ReturnType<typeof observeControls> },
  label: string,
) => Effect.promise(async () => s.controls.click(label));

effectIt.effect(
  "copies the bundle and saves the same bytes to the file the user picks",
  () =>
    Effect.gen(function* () {
      let saved = "";
      const s = yield* sharing(async (folder) => {
        saved = join(folder, "Books.md");
        return { canceled: false, filePath: saved };
      });
      yield* output(s, m.profile_share_copy());
      const copied = s.clipboard.mock.calls[0]![0];
      yield* output(s, m.profile_share_save());
      expect(yield* Effect.promise(() => readFile(saved, "utf8"))).toBe(copied);
      s.modal.onClose();
      yield* Fiber.join(s.pending);
    }),
);

effectIt.effect("cancels a save without writing", () =>
  Effect.gen(function* () {
    const s = yield* sharing();
    yield* press(s, m.profile_share_save());
    yield* until(() => s.showSaveDialog.mock.calls.length === 1);
    s.modal.onClose();
    yield* Fiber.join(s.pending);
    expect(yield* Effect.promise(() => readdir(s.folder))).toEqual([]);
  }),
);

effectIt.effect(
  "does not write when the Share sheet closes while the save dialog is open",
  () =>
    Effect.gen(function* () {
      const selection = Promise.withResolvers<{
        canceled: boolean;
        filePath: string;
      }>();
      const s = yield* sharing(() => selection.promise);
      yield* press(s, m.profile_share_save());
      yield* until(() => s.showSaveDialog.mock.calls.length === 1);
      s.modal.onClose();
      selection.resolve({
        canceled: false,
        filePath: join(s.folder, "Default.md"),
      });
      yield* Fiber.join(s.pending);
      expect(yield* Effect.promise(() => readdir(s.folder))).toEqual([]);
    }),
);

effectIt.effect("copies again after the clipboard refuses the bundle", () =>
  Effect.gen(function* () {
    const s = yield* sharing();
    s.clipboard.mockRejectedValueOnce(new Error("Clipboard unavailable"));
    yield* output(s, m.profile_share_copy());
    yield* output(s, m.profile_share_copy());
    expect(s.clipboard).toHaveBeenCalledTimes(2);
    s.modal.onClose();
    yield* Fiber.join(s.pending);
  }),
);
