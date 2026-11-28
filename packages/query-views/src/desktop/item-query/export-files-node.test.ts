import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { layer } from "@effect/vitest";
import {
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Fiber,
  PlatformError,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { layerNodeFileSystemWith } from "@zotlit/obsidian-desktop/__fixtures__/node-file-system.ts";

import { nodeExportFiles } from "./export-files-node.ts";

import { describeExportFilesContract } from "#__fixtures__/item-query/export-files-suite.ts";

const files = Effect.map(FileSystem.FileSystem, (fs) =>
  nodeExportFiles(fs),
).pipe(Effect.provide(NodeFileSystem.layer));

const newFolder = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "zotlit-export-files-" }),
).pipe(Effect.orDie, Effect.provide(NodeFileSystem.layer));

const names = (folder: string) =>
  Effect.promise(async () => (await readdir(folder)).sort());

describeExportFilesContract("the Node adapter", {
  files,
  folder: Effect.map(newFolder, (folder) => ({
    path: (name) => join(folder, name),
    missing: (name) => join(folder, "missing", name),
    names: names(folder),
    read: (name) =>
      Effect.promise(
        async () => new Uint8Array(await readFile(join(folder, name))),
      ),
    put: (name, bytes) =>
      Effect.promise(() => writeFile(join(folder, name), bytes)),
  })),
});

const DEAD_PID = 4_194_305;
const STAMP = 1_000_000;
const document = Stream.make(new TextEncoder().encode("{}"));

const staging = (output: string, pid: number) =>
  `${output}.${pid}-${randomUUID()}.zotlit-partial`;

const leave = (folder: string, name: string) =>
  Effect.promise(async () => {
    await writeFile(join(folder, name), "partial");
    await utimes(join(folder, name), STAMP, STAMP);
  });

const exportAtAge = (folder: string, age: Duration.Duration) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(STAMP * 1000 + Duration.toMillis(age));
    yield* (yield* files).write(join(folder, "new.json"), document);
  });

layer(NodeFileSystem.layer)("the Node adapter of the export files", (it) => {
  it.effect("names its staging file after the output and this process", () =>
    Effect.gen(function* () {
      const folder = yield* newFolder;
      const written = yield* Deferred.make<void>();
      const open = document.pipe(
        Stream.concat(
          Stream.fromEffect(
            Deferred.succeed(written, undefined).pipe(
              Effect.andThen(Effect.never),
            ),
          ),
        ),
      );
      const fiber = yield* Effect.forkChild(
        (yield* files).write(join(folder, "answer.json"), open),
      );
      yield* Deferred.await(written);
      expect(yield* names(folder)).toEqual([
        expect.stringMatching(
          new RegExp(
            `^answer\\.json\\.${process.pid}-[0-9a-f-]{36}\\.zotlit-partial$`,
          ),
        ),
      ]);
      yield* Fiber.interrupt(fiber);
      expect(yield* names(folder)).toEqual([]);
    }),
  );

  it.effect(
    "fails with the message of the system when the staging file does not close, and publishes no file",
    () =>
      Effect.gen(function* () {
        const folder = yield* newFolder;
        const closeFailure = PlatformError.systemError({
          _tag: "Unknown",
          module: "FileSystem",
          method: "close",
          cause: Object.assign(new Error("EIO: i/o error, close"), {
            code: "EIO",
          }),
        });
        const failingClose = Effect.map(FileSystem.FileSystem, (fs) =>
          nodeExportFiles(fs),
        ).pipe(
          Effect.provide(
            layerNodeFileSystemWith((fs) => ({
              open: (path, options) =>
                fs
                  .open(path, options)
                  .pipe(
                    Effect.tap(() =>
                      Effect.addFinalizer(() => Effect.die(closeFailure)),
                    ),
                  ),
            })),
          ),
        );

        const error = yield* Effect.flip(
          (yield* failingClose).write(join(folder, "answer.json"), document),
        );

        expect(error).toMatchObject({
          _tag: "ExportFileError",
          message: "EIO: i/o error, close",
        });
        expect(yield* names(folder)).toEqual([]);
      }),
  );

  it.effect(
    "removes a staging file of a process that is not live and that is older than 1 hour",
    () =>
      Effect.gen(function* () {
        const folder = yield* newFolder;
        yield* leave(folder, staging("old.json", DEAD_PID));
        yield* exportAtAge(folder, Duration.hours(2));
        expect(yield* names(folder)).toEqual(["new.json"]);
      }),
  );

  it.effect(
    "keeps a directory with a staging name of a process that is not live, and its content",
    () =>
      Effect.gen(function* () {
        const folder = yield* newFolder;
        const directory = staging("old.json", DEAD_PID);
        yield* Effect.promise(async () => {
          await mkdir(join(folder, directory));
          await writeFile(join(folder, directory, "notes.md"), "keep this");
          await utimes(join(folder, directory), STAMP, STAMP);
        });
        yield* exportAtAge(folder, Duration.hours(2));
        expect(yield* names(folder)).toEqual(["new.json", directory]);
        expect(yield* names(join(folder, directory))).toEqual(["notes.md"]);
      }),
  );

  it.effect("keeps a staging file younger than 1 hour", () =>
    Effect.gen(function* () {
      const folder = yield* newFolder;
      const young = staging("old.json", DEAD_PID);
      yield* leave(folder, young);
      yield* exportAtAge(folder, Duration.minutes(30));
      expect(yield* names(folder)).toEqual(["new.json", young]);
    }),
  );

  it.effect("keeps a staging file of a live process", () =>
    Effect.gen(function* () {
      const folder = yield* newFolder;
      const live = [
        staging("old.json", process.pid),
        staging("old.json", process.ppid),
      ].sort();
      for (const name of live) yield* leave(folder, name);
      yield* exportAtAge(folder, Duration.hours(2));
      expect(yield* names(folder)).toEqual(["new.json", ...live]);
    }),
  );

  it.effect("keeps each file that does not match the staging pattern", () =>
    Effect.gen(function* () {
      const folder = yield* newFolder;
      const others = [
        "notes.md",
        "old.json.zotlit-partial",
        `old.json.${DEAD_PID}-not-a-uuid.zotlit-partial`,
        `old.json.0-${randomUUID()}.zotlit-partial`,
        `old.json.${DEAD_PID}-${randomUUID()}.tmp`,
        `.zotlit-query-${randomUUID()}.tmp`,
      ];
      for (const name of others) yield* leave(folder, name);
      yield* exportAtAge(folder, Duration.hours(2));
      expect(yield* names(folder)).toEqual(["new.json", ...others].sort());
    }),
  );
});
