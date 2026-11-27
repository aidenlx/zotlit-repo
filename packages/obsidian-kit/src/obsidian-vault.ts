import type { ObsidianEventEmitter } from "#obsidian-event-source.ts";
import type { Stream } from "effect";
import { Context, Effect, Layer } from "effect";
import type {
  App,
  DataAdapter,
  DataWriteOptions,
  TAbstractFile,
  TFile,
  Vault as ObsidianVault,
} from "obsidian";
import { TFolder } from "obsidian";

import { isErrno } from "@zotlit/plugin-kernel/errno.ts";
import {
  FileExists,
  FileNotFound,
  vaultError,
} from "@zotlit/plugin-kernel/vault-errors.ts";
import type { VaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import { basename, dirname } from "@zotlit/plugin-kernel/vault-path.ts";

import { joinFolderPath } from "#ensure-folder.ts";
import { ObsidianApp } from "#obsidian-app.ts";
import { obsidianEventSource } from "#obsidian-event-source.ts";

export function vaultTextWriter({
  vault,
}: Pick<App, "vault">): Pick<DataAdapter, "write" | "append"> {
  return {
    write: (path, text, options) => vault.adapter.write(path, text, options),
    append: (path, text, options) => vault.adapter.append(path, text, options),
  };
}

export type VaultEvent =
  | { readonly _tag: "create"; readonly file: TAbstractFile }
  | { readonly _tag: "modify"; readonly file: TAbstractFile }
  | {
      readonly _tag: "rename";
      readonly file: TAbstractFile;
      readonly oldPath: string;
    }
  | { readonly _tag: "delete"; readonly file: TAbstractFile };

export type VaultSource = Pick<
  ObsidianVault,
  | "read"
  | "cachedRead"
  | "process"
  | "create"
  | "createFolder"
  | "trash"
  | "getFileByPath"
  | "getFolderByPath"
  | "getAbstractFileByPath"
  | "getAbstractFileByPathInsensitive"
  | "getMarkdownFiles"
> & {
  readonly adapter: Pick<DataAdapter, "read" | "getResourcePath">;
} & ObsidianEventEmitter;

export interface VaultShape {
  read(file: TFile): Effect.Effect<string, VaultError>;
  cachedRead(file: TFile): Effect.Effect<string, VaultError>;
  resourcePath(path: string): Effect.Effect<string>;
  readPath(path: string): Effect.Effect<string, FileNotFound | VaultError>;
  process(
    file: TFile,
    fn: (data: string) => string,
    options?: DataWriteOptions,
  ): Effect.Effect<string, VaultError>;
  create(
    path: string,
    data: string,
    options?: DataWriteOptions,
  ): Effect.Effect<TFile, FileExists | VaultError>;
  createFolder(path: string): Effect.Effect<TFolder, VaultError>;
  trash(file: TAbstractFile, system: boolean): Effect.Effect<void, VaultError>;
  getFileByPath(path: string): Effect.Effect<TFile | null>;
  getFolderByPath(path: string): Effect.Effect<TFolder | null>;
  getAbstractFileByPath(path: string): Effect.Effect<TAbstractFile | null>;
  underHeldParent(path: string): Effect.Effect<string>;
  getAbstractFileByPathInsensitive(
    path: string,
  ): Effect.Effect<TAbstractFile | null>;
  readonly getMarkdownFiles: Effect.Effect<TFile[]>;
  readonly changes: Stream.Stream<VaultEvent>;
}

export class Vault extends Context.Service<Vault, VaultShape>()(
  "zotlit/obsidian/Vault",
) {}

const call = <A>(
  operation: string,
  path: string,
  run: () => Promise<A>,
): Effect.Effect<A, VaultError> =>
  Effect.tryPromise({ try: run, catch: vaultError(operation, path) });

export const makeVault = Effect.fnUntraced(function* (source: VaultSource) {
  const events = yield* obsidianEventSource<VaultEvent>();
  yield* events.listen(source, "create", (file: TAbstractFile) => ({
    _tag: "create",
    file,
  }));
  yield* events.listen(source, "modify", (file: TAbstractFile) => ({
    _tag: "modify",
    file,
  }));
  yield* events.listen(
    source,
    "rename",
    (file: TAbstractFile, oldPath: string) => ({
      _tag: "rename",
      file,
      oldPath,
    }),
  );
  yield* events.listen(source, "delete", (file: TAbstractFile) => ({
    _tag: "delete",
    file,
  }));
  const underHeldParent = (path: string): string => {
    const parent = heldParent(path);
    return parent ? joinFolderPath(parent.path, basename(path)) : path;
  };
  const heldParent = (path: string): TFolder | null => {
    const parent = dirname(path);
    const held =
      parent === "."
        ? source.getFolderByPath("/")
        : source.getAbstractFileByPathInsensitive(parent);
    return held instanceof TFolder ? held : null;
  };
  const heldInAnyCase = (path: string): TAbstractFile | null => {
    const exact = source.getAbstractFileByPath(path);
    if (exact) return exact;
    const name = basename(path).toLowerCase();
    return (
      heldParent(path)?.children.find(
        (child) => basename(child.path).toLowerCase() === name,
      ) ?? null
    );
  };
  return Vault.of({
    resourcePath: Effect.fn("Vault.resourcePath")((path) =>
      Effect.sync(() => source.adapter.getResourcePath(path)),
    ),
    read: Effect.fn("Vault.read")((file) =>
      call("read", file.path, () => source.read(file)),
    ),
    cachedRead: Effect.fn("Vault.cachedRead")((file) =>
      call("cachedRead", file.path, () => source.cachedRead(file)),
    ),
    readPath: Effect.fn("Vault.readPath")((path) =>
      Effect.tryPromise({
        try: () => source.adapter.read(path),
        catch: (cause) =>
          isErrno(cause, "ENOENT")
            ? new FileNotFound({ path, cause })
            : vaultError("readPath", path)(cause),
      }),
    ),
    process: Effect.fn("Vault.process")((file, fn, options) =>
      call("process", file.path, () => source.process(file, fn, options)),
    ),
    create: Effect.fn("Vault.create")(
      (path, data, options): Effect.Effect<TFile, FileExists | VaultError> => {
        const held = heldInAnyCase(path);
        if (held) return Effect.fail(new FileExists({ path: held.path }));
        const target = underHeldParent(path);
        return call("create", target, () =>
          source.create(target, data, options),
        );
      },
    ),
    createFolder: Effect.fn("Vault.createFolder")((path) =>
      call("createFolder", path, () => source.createFolder(path)),
    ),
    trash: Effect.fn("Vault.trash")((file, system) =>
      call("trash", file.path, () => source.trash(file, system)),
    ),
    getFileByPath: Effect.fn("Vault.getFileByPath")((path) =>
      Effect.sync(() => source.getFileByPath(path)),
    ),
    getFolderByPath: Effect.fn("Vault.getFolderByPath")((path) =>
      Effect.sync(() => source.getFolderByPath(path)),
    ),
    getAbstractFileByPath: Effect.fn("Vault.getAbstractFileByPath")((path) =>
      Effect.sync(() => source.getAbstractFileByPath(path)),
    ),
    underHeldParent: Effect.fn("Vault.underHeldParent")((path) =>
      Effect.sync(() => underHeldParent(path)),
    ),
    getAbstractFileByPathInsensitive: Effect.fn(
      "Vault.getAbstractFileByPathInsensitive",
    )((path) =>
      Effect.sync(() => source.getAbstractFileByPathInsensitive(path)),
    ),
    getMarkdownFiles: Effect.sync(() => source.getMarkdownFiles()).pipe(
      Effect.withSpan("Vault.getMarkdownFiles"),
    ),
    changes: events.stream,
  });
});

export const layerVaultFrom = (source: VaultSource): Layer.Layer<Vault> =>
  Layer.effect(Vault, makeVault(source));

export const layerVault: Layer.Layer<Vault, never, ObsidianApp> = Layer.effect(
  Vault,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return yield* makeVault(app.vault);
  }),
);
