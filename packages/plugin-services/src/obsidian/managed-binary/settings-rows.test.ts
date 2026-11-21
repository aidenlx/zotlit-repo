// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import { describe } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";

import { ManagedBinaryError } from "./platform.ts";
import { installBinary, managedBinaryDefinition } from "./settings-rows.ts";
import type { ManagedBinaryCopy } from "./settings-rows.ts";

import { binary, button } from "#__fixtures__/managed-binary-rows.ts";
import { scopedSettingTab, testSettingTab } from "#__fixtures__/setting-tab.ts";

const COPY: ManagedBinaryCopy = {
  id: "settings_segmenter",
  name: "Segmenter",
  desc: "Cuts words.",
  status: {
    absent: "Not installed.",
    installing: "Installing.",
    installed: (version) => `Version ${version}.`,
    downloadFailed: (detail) => `Download failed: ${detail}.`,
    hashMismatch: "Hash mismatch.",
    initFailed: (detail) => `Start failed: ${detail}.`,
  },
  actions: {
    install: "Install",
    installing: "Installing…",
    retry: "Retry",
    uninstall: "Uninstall",
  },
  notices: {
    downloading: "Downloading the segmenter",
    installed: "Segmenter installed",
    installFailed: "Segmenter install failed",
    removed: "Segmenter removed",
    removeFailed: "Segmenter removal failed",
  },
};

/** The tab over a recording Notifier whose tracked notices run on the test's Scope. */
const notifiedTab = Effect.gen(function* () {
  const services = yield* Layer.build(testNotifier().layer);
  const { tab } = yield* scopedSettingTab(services);
  return { tab };
});

describe("managedBinaryDefinition", () => {
  it.effect("offers the install while nothing is cached", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { tab } = yield* notifiedTab;
        const fake = binary({ kind: "absent" });
        const row = managedBinaryDefinition(
          tab,
          Effect.succeed(fake.api),
          COPY,
        );

        expect(row).toMatchObject({
          id: "settings_segmenter",
          name: "Segmenter",
          desc: "Cuts words. Not installed.",
        });
        const install = button(renderRow(row));
        expect(install.text).toBe("Install");

        install.click();
        yield* eventually(() => expect(fake.install).toHaveBeenCalledOnce());
      }),
    ),
  );

  it.effect("fails the install with the install's own error", () =>
    Effect.gen(function* () {
      const failure = new ManagedBinaryError({ message: "offline" });
      const fake = binary({ kind: "absent" }, Effect.fail(failure));

      const error = yield* installBinary(Effect.succeed(fake.api), COPY).pipe(
        Effect.provide(testNotifier().layer),
        Effect.flip,
      );

      expect(error).toBe(failure);
      expect(fake.install).toHaveBeenCalledOnce();
    }),
  );

  it.effect("ends the install with no failure once it is done", () =>
    Effect.gen(function* () {
      const fake = binary({ kind: "absent" });

      const exit = yield* installBinary(Effect.succeed(fake.api), COPY).pipe(
        Effect.provide(testNotifier().layer),
        Effect.exit,
      );

      expect(Exit.isSuccess(exit)).toBe(true);
    }),
  );

  it.effect("offers the removal once installed", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { tab } = yield* notifiedTab;
        const fake = binary({
          kind: "installed",
          version: "2.4.0",
          binary: { directory: "chinese-segmenter", name: "jieba.wasm" },
        });
        const row = managedBinaryDefinition(
          tab,
          Effect.succeed(fake.api),
          COPY,
        );

        expect(row).toMatchObject({ desc: "Cuts words. Version 2.4.0." });
        const uninstall = button(renderRow(row));
        expect(uninstall.text).toBe("Uninstall");

        uninstall.click();
        yield* eventually(() => expect(fake.uninstall).toHaveBeenCalledOnce());
      }),
    ),
  );

  it("names the failure and offers a retry", () => {
    const row = managedBinaryDefinition(
      testSettingTab().tab,
      Effect.succeed(
        binary({
          kind: "failed",
          failure: { code: "download-failed", url: "u", detail: "offline" },
        }).api,
      ),
      COPY,
    );

    expect(row).toMatchObject({
      desc: "Cuts words. Download failed: offline.",
    });
    expect(button(renderRow(row)).text).toBe("Retry");
  });
});
