import { Effect, FileSystem, Layer } from "effect";
import { systemError } from "effect/PlatformError";

import { Vault } from "#obsidian-vault.ts";

export const layerVaultFileSystem: Layer.Layer<
  FileSystem.FileSystem,
  never,
  Vault
> = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const vault = yield* Vault;
    const readFileString = (path: string) =>
      vault.readPath(path).pipe(
        Effect.mapError((cause) =>
          systemError({
            _tag: cause._tag === "FileNotFound" ? "NotFound" : "Unknown",
            module: "FileSystem",
            method: "readFileString",
            pathOrDescriptor: path,
            cause,
          }),
        ),
      );
    return FileSystem.makeNoop({
      readFileString,
      exists: (path) =>
        readFileString(path).pipe(
          Effect.as(true),
          Effect.catchIf(
            (error) => error.reason._tag === "NotFound",
            () => Effect.succeed(false),
          ),
        ),
    });
  }),
);
