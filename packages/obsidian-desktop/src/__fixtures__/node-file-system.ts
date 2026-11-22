import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { Effect, FileSystem, Layer } from "effect";

export function layerNodeFileSystemWith(
  overrides: (fs: FileSystem.FileSystem) => Partial<FileSystem.FileSystem>,
): Layer.Layer<FileSystem.FileSystem> {
  return Layer.effect(
    FileSystem.FileSystem,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      return FileSystem.FileSystem.of({ ...fs, ...overrides(fs) });
    }),
  ).pipe(Layer.provide(NodeFileSystem.layer));
}
