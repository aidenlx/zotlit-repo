import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TFile } from "obsidian";
import { vi } from "vitest";

import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";

import { obsidianAttachmentReader } from "./obsidian-reader.ts";
import type { ReaderOutcome } from "./open-target.ts";

const ATTACHMENT: ObsidianOpenableAttachment = {
  indexedKey: "ATCH2345",
  label: "Doe 2024.pdf",
  openPath: "papers/Doe 2024.pdf",
  absolutePath: "/vault/papers/Doe 2024.pdf",
};

function vaultWith(file: TFile | null) {
  return Layer.mock(Vault, {
    getFileByPath: (path: string) =>
      Effect.succeed(path === ATTACHMENT.openPath ? file : null),
  });
}

function reader(onOpened = vi.fn()) {
  const open = vi.fn(
    (
      _file: TFile,
      _subpath: string,
      _pane: unknown,
    ): Effect.Effect<ReaderOutcome> => Effect.succeed("opened"),
  );
  return {
    open,
    onOpened,
    made: obsidianAttachmentReader({
      open,
      onOpened: Effect.sync(() => onOpened()),
    }),
  };
}

it.effect("opens the resolved vault file, naming the Attachment it opens", () =>
  Effect.gen(function* () {
    const file = new TFile();
    const { open, made } = reader();
    const target = yield* made.pipe(Effect.provide(vaultWith(file)));
    expect(yield* target.open(ATTACHMENT, false)).toBe("opened");
    expect(open).toHaveBeenCalledWith(file, "#zt-attachment=ATCH2345", false);
  }),
);

it.effect(
  "lands on the page a subpath names, naming the Attachment beside it",
  () =>
    Effect.gen(function* () {
      const file = new TFile();
      const { open, made } = reader();
      const target = yield* made.pipe(Effect.provide(vaultWith(file)));
      yield* target.open({ ...ATTACHMENT, subpath: "#page=7" }, false);
      expect(open).toHaveBeenCalledWith(
        file,
        "#page=7&zt-attachment=ATCH2345",
        false,
      );
    }),
);

it.effect(
  "reports a missing file and opens nothing when Obsidian resolves no file for the open path, and leaves onOpened unrun",
  () =>
    Effect.gen(function* () {
      const { open, onOpened, made } = reader();
      const target = yield* made.pipe(Effect.provide(vaultWith(null)));
      expect(yield* target.open(ATTACHMENT, false)).toBe("file-missing");
      expect(open).not.toHaveBeenCalled();
      expect(onOpened).not.toHaveBeenCalled();
    }),
);

it.effect("runs onOpened once the file is on screen", () =>
  Effect.gen(function* () {
    const { onOpened, made } = reader();
    const target = yield* made.pipe(Effect.provide(vaultWith(new TFile())));
    yield* target.open(ATTACHMENT, false);
    expect(onOpened).toHaveBeenCalledOnce();
  }),
);
