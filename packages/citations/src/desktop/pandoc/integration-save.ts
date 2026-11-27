import type { Scope } from "effect";
import { Effect, FileSystem } from "effect";
import { join } from "node:path";

export type SavePandocIntegrationResult =
  | { kind: "cancelled" }
  | { kind: "saved"; folder: string }
  | {
      kind: "failed";
      error: unknown;
      restored: boolean;
      backups: readonly string[];
    };

export interface SavePandocIntegrationOptions {
  folder: string;
  files: Readonly<Record<string, string>>;
  confirmReplacement: (
    filenames: readonly string[],
  ) => Effect.Effect<boolean, unknown>;
}

interface PairEntry {
  filename: string;
  contents: string;
  target: string;
  previous: string | null;
}

export const savePandocIntegrationFiles = Effect.fn("PandocIntegration.save")(
  function* ({
    folder,
    files,
    confirmReplacement,
  }: SavePandocIntegrationOptions) {
    const fs = yield* FileSystem.FileSystem;
    return yield* Effect.scoped(
      Effect.gen(function* (): Effect.fn.Return<
        SavePandocIntegrationResult,
        unknown,
        Scope.Scope
      > {
        const entries = yield* Effect.forEach(
          Object.entries(files),
          Effect.fnUntraced(function* ([filename, contents]) {
            const target = join(folder, filename);
            const previous = yield* fs
              .readFileString(target)
              .pipe(
                Effect.catchReason("PlatformError", "NotFound", () =>
                  Effect.succeed(null),
                ),
              );
            return { filename, contents, target, previous };
          }),
          { concurrency: "unbounded" },
        );
        const existing = entries
          .filter((entry) => entry.previous !== null)
          .map((entry) => entry.filename);
        if (existing.length > 0 && !(yield* confirmReplacement(existing)))
          return { kind: "cancelled" };

        const backups: string[] = [];
        const temp = yield* Effect.acquireRelease(
          fs.makeTempDirectory({
            directory: folder,
            prefix: ".zotlit-pandoc-",
          }),
          (path) => {
            if (backups.length === 0) {
              return fs
                .remove(path, { recursive: true, force: true })
                .pipe(Effect.ignore);
            }
            return Effect.forEach(
              entries,
              (entry) =>
                fs
                  .remove(join(path, entry.filename), { force: true })
                  .pipe(Effect.ignore),
              { discard: true },
            );
          },
        );
        for (const entry of entries) {
          yield* fs.writeFileString(
            join(temp, entry.filename),
            entry.contents,
            { flag: "wx" },
          );
        }

        const backedUp: PairEntry[] = [];
        const installed: PairEntry[] = [];
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const install = yield* Effect.gen(function* () {
              for (const entry of entries) {
                if (entry.previous === null) continue;
                yield* fs.rename(
                  entry.target,
                  join(temp, `.previous-${entry.filename}`),
                );
                backedUp.push(entry);
              }
              for (const entry of entries) {
                yield* fs.rename(join(temp, entry.filename), entry.target);
                installed.push(entry);
              }
            }).pipe(Effect.result);
            if (install._tag === "Success")
              return { kind: "saved", folder } as const;

            const errors: unknown[] = [];
            const collect = <E>(effect: Effect.Effect<void, E>) =>
              effect.pipe(
                Effect.catch((error) =>
                  Effect.sync(() => {
                    errors.push(error);
                  }),
                ),
              );
            for (const entry of installed.toReversed()) {
              yield* collect(
                fs
                  .remove(entry.target)
                  .pipe(
                    Effect.catchReason(
                      "PlatformError",
                      "NotFound",
                      () => Effect.void,
                    ),
                  ),
              );
            }
            for (const entry of backedUp.toReversed()) {
              const backup = join(temp, `.previous-${entry.filename}`);
              const restore = yield* fs
                .rename(backup, entry.target)
                .pipe(Effect.result);
              if (restore._tag === "Failure") {
                errors.push(restore.failure);
                backups.push(backup);
              }
            }
            return {
              kind: "failed",
              restored: errors.length === 0,
              backups,
              error:
                errors.length === 0
                  ? install.failure
                  : new AggregateError(
                      [install.failure, ...errors],
                      "Failed to save and restore the Pandoc Integration Pair",
                    ),
            } as const;
          }),
        );
      }),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed<SavePandocIntegrationResult>({
          kind: "failed",
          error,
          restored: true,
          backups: [],
        }),
      ),
    );
  },
);
