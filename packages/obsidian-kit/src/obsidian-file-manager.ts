import { Context, Effect, Layer } from "effect";
import type {
  FileManager as ObsidianFileManager,
  TAbstractFile,
  TFile,
} from "obsidian";
import { normalizePath } from "obsidian";

import { FileExists, vaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import type { VaultError } from "@zotlit/plugin-kernel/vault-errors.ts";

import { ObsidianApp } from "#obsidian-app.ts";
import { Vault } from "#obsidian-vault.ts";

export type FileManagerSource = Pick<
  ObsidianFileManager,
  | "processFrontMatter"
  | "renameFile"
  | "generateMarkdownLink"
  | "getAvailablePathForAttachment"
  | "trashFile"
>;

export interface FileManagerShape {
  processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void,
  ): Effect.Effect<void, VaultError>;
  renameFile(
    file: TFile,
    newPath: string,
  ): Effect.Effect<void, FileExists | VaultError>;
  generateMarkdownLink(
    file: TFile,
    sourcePath: string,
    options?: { readonly subpath?: string; readonly alias?: string },
  ): Effect.Effect<string>;
  getAvailablePathForAttachment(
    filename: string,
    sourcePath?: string,
  ): Effect.Effect<string, VaultError>;
  trashFile(file: TAbstractFile): Effect.Effect<void, VaultError>;
}

export type MarkdownLinker = (
  file: TFile,
  sourcePath: string,
  options?: { readonly subpath?: string; readonly alias?: string },
) => string;

export class FileManager extends Context.Service<
  FileManager,
  FileManagerShape
>()("zotlit/obsidian/FileManager") {}

export const makeFileManager = Effect.fnUntraced(function* (
  source: FileManagerSource,
) {
  const vault = yield* Vault;
  return FileManager.of({
    processFrontMatter: Effect.fn("FileManager.processFrontMatter")(
      (file, fn) =>
        Effect.tryPromise({
          try: () => source.processFrontMatter(file, fn),
          catch: vaultError("processFrontMatter", file.path),
        }),
    ),
    renameFile: Effect.fn("FileManager.renameFile")(function* (file, newPath) {
      const path = normalizePath(newPath);
      const held = yield* vault.getAbstractFileByPath(path);
      if (held !== null && held !== file)
        return yield* new FileExists({ path });
      const target = yield* vault.underHeldParent(path);
      yield* Effect.tryPromise({
        try: () => source.renameFile(file, target),
        catch: vaultError("renameFile", file.path),
      });
    }),
    generateMarkdownLink: Effect.fn("FileManager.generateMarkdownLink")(
      (file, sourcePath, options = {}) =>
        Effect.sync(() =>
          source.generateMarkdownLink(
            file,
            sourcePath,
            options.subpath,
            options.alias,
          ),
        ),
    ),
    getAvailablePathForAttachment: Effect.fn(
      "FileManager.getAvailablePathForAttachment",
    )((filename, sourcePath) =>
      Effect.tryPromise({
        try: () => source.getAvailablePathForAttachment(filename, sourcePath),
        catch: vaultError("getAvailablePathForAttachment", sourcePath ?? "/"),
      }),
    ),
    trashFile: Effect.fn("FileManager.trashFile")((file) =>
      Effect.tryPromise({
        try: () => source.trashFile(file),
        catch: vaultError("trashFile", file.path),
      }),
    ),
  });
});

export const layerFileManagerFrom = (
  source: FileManagerSource,
): Layer.Layer<FileManager, never, Vault> =>
  Layer.effect(FileManager, makeFileManager(source));

export const layerFileManager: Layer.Layer<
  FileManager,
  never,
  ObsidianApp | Vault
> = Layer.effect(
  FileManager,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    return yield* makeFileManager(app.fileManager);
  }),
);

export const markdownLinker: Effect.Effect<MarkdownLinker, never, FileManager> =
  Effect.gen(function* () {
    const run = Effect.runSyncWith(yield* Effect.context<FileManager>());
    return (file, sourcePath, options) =>
      run(
        Effect.flatMap(FileManager, (fileManager) =>
          fileManager.generateMarkdownLink(file, sourcePath, options),
        ),
      );
  });
