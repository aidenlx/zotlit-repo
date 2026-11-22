import type { ExcerptRequest } from "#obsidian/excerpt-image/contract.ts";
import type { ExcerptOutcome } from "#obsidian/excerpt-image/service.ts";
import {
  Cause,
  Effect,
  Exit,
  FileSystem,
  RcMap,
  Schema,
  Semaphore,
} from "effect";
import { createHash, randomUUID } from "node:crypto";
import { basename, dirname, join, relative, isAbsolute, sep } from "node:path";

import { attachmentFolderPath } from "@zotlit/obsidian-kit/attachment-folder.ts";
import { joinFolderPath } from "@zotlit/obsidian-kit/ensure-folder.ts";
import type { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type {} from "@zotlit/plugin-services/core/attachment-import/settings.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import { excerptAssetKey } from "./key.ts";
import { usableExcerptPng } from "./png.ts";

import {
  EXCERPT_IMAGE_EXTENSIONS,
  detectExcerptImageFormat,
  isExcerptImage,
  isExcerptPayload,
} from "#core/excerpt-image/format.ts";
import { usableExcerptWebpPixels } from "#core/excerpt-image/webp-pixels.ts";
import { excerptSourceIdentities } from "#obsidian/excerpt-image/contract.ts";

const logged = withLogCategory("excerpt-materialize");
const MAX_PREVIOUS_BYTES = 32 * 1024 * 1024;
const SHA256_HEX_LENGTH = 64;

const usableExternalAsset = (bytes: Uint8Array) =>
  Effect.promise(async () => {
    const format = detectExcerptImageFormat(bytes);
    if (!format || !isExcerptPayload(format, bytes)) return false;
    if (format.format === "webp") return usableExcerptWebpPixels(bytes);
    return usableExcerptPng(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  });

export class ExcerptAssetRefused extends Schema.TaggedError<
  ExcerptAssetRefused,
  { readonly brand: unique symbol }
>()("ExcerptAssetRefused", { message: Schema.String }) {}

const readPreviousImage = (path: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const file = yield* (yield* FileSystem.FileSystem).open(path, {
        flag: "r",
      });
      const size = Number((yield* file.stat).size);
      if (size > MAX_PREVIOUS_BYTES)
        return yield* new ExcerptAssetRefused({
          message: "Previous excerpt exceeds byte limit",
        });
      const buffer = Buffer.alloc(size + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const bytesRead = yield* file.read(buffer.subarray(offset));
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > size)
        return yield* new ExcerptAssetRefused({
          message: "Previous excerpt grew during verification",
        });
      return buffer.subarray(0, offset);
    }),
  );

const removeIgnoringAbsent = (path: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(path)).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
  );

export type PublicationGate = (
  destination: string,
) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

export const makePublicationGate = Effect.gen(function* () {
  const locks = yield* RcMap.make({
    lookup: (_destination: string) => Semaphore.make(1),
  });
  const gate: PublicationGate = (destination) => (effect) =>
    Effect.scoped(
      Effect.flatMap(RcMap.get(locks, destination), (lock) =>
        lock.withPermits(1)(effect),
      ),
    );
  return gate;
});

export type MaterializedExcerpt =
  | {
      kind: "saved";
      path: string;
      outcome: Extract<ExcerptOutcome, { kind: "available" }>;
    }
  | { kind: "retained"; path: string }
  | { kind: "unavailable"; reason: "disabled" | "source" | "write" };

export const retainExcerpt = Effect.fnUntraced(function* (options: {
  request: ExcerptRequest;
  paths: readonly string[];
}): Effect.fn.Return<
  Extract<MaterializedExcerpt, { kind: "retained" }> | undefined,
  never,
  FileSystem.FileSystem | Vault
> {
  const vault = yield* Vault;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* vault.fullPath("");
  if (root === null) return;
  const identities = excerptAssetIdentities(options.request);
  for (const path of options.paths) {
    const full = (yield* vault.fullPath(path)) ?? path;
    const local = relative(root, full);
    if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
      continue;
    const name = basename(path);
    const owned = isOwnedExcerptAssetPath(path, identities);
    const legacy =
      name === `${parseIndexedKey(options.request.annotation.key)?.key}.png`;
    if (!owned && !legacy) continue;
    const verified = yield* Effect.gen(function* () {
      const actualPath = yield* fs.realPath(full);
      const actualRoot = yield* fs.realPath(root);
      const actualRelative = relative(actualRoot, actualPath);
      if (
        isAbsolute(actualRelative) ||
        actualRelative === ".." ||
        actualRelative.startsWith(`..${sep}`)
      )
        return false;
      const bytes = yield* readPreviousImage(actualPath);
      if (!(yield* usableExternalAsset(bytes))) return false;
      const { zoteroPngPath } = options.request;
      if (
        !owned &&
        (!zoteroPngPath ||
          !bytes.equals(yield* readPreviousImage(zoteroPngPath)))
      )
        return false;
      return true;
    }).pipe(
      recover(
        (cause) =>
          Effect.logDebug("Previous excerpt could not be verified").pipe(
            Effect.annotateLogs({ path, cause }),
            logged,
          ),
        Effect.succeed(false),
      ),
    );
    if (verified) return { kind: "retained", path };
  }
});

export function excerptAssetIdentities(
  request: Pick<
    ExcerptRequest,
    "sourceScope" | "source" | "libraryID" | "attachmentKey"
  > & { annotation: { key: string } },
): string[] {
  return excerptSourceIdentities(request.source).map((sourceIdentity) =>
    createHash("sha256")
      .update(
        JSON.stringify([
          request.sourceScope,
          sourceIdentity,
          request.libraryID,
          request.attachmentKey,
          request.annotation.key,
        ]),
      )
      .digest("hex"),
  );
}

export function isOwnedExcerptAssetPath(
  path: string,
  identities: readonly string[],
): boolean {
  const name = basename(path);
  return identities.some((identity) => {
    const prefix = `zotlit-excerpt-${identity}-`;
    if (!name.startsWith(prefix)) return false;
    const digest = name.slice(prefix.length);
    const dot = digest.indexOf(".");
    return (
      dot === SHA256_HEX_LENGTH &&
      EXCERPT_IMAGE_EXTENSIONS.has(digest.slice(dot + 1))
    );
  });
}

export const materializeExcerpt = Effect.fnUntraced(function* (options: {
  gate: PublicationGate;
  notePath: string;
  settings: Readonly<Settings>;
  request: ExcerptRequest;
  outcome: ExcerptOutcome;
  valid?: Effect.Effect<boolean>;
}): Effect.fn.Return<
  MaterializedExcerpt,
  never,
  FileManager | FileSystem.FileSystem | Vault
> {
  const { request, outcome, settings } = options;
  if (!settings["attachment.import"])
    return { kind: "unavailable", reason: "disabled" };
  if (outcome.kind === "unavailable")
    return { kind: "unavailable", reason: "source" };
  if (!isExcerptImage(outcome)) {
    yield* Effect.logDebug("Excerpt payload does not match its format").pipe(
      Effect.annotateLogs({
        format: outcome.format.format,
        bytes: outcome.bytes.byteLength,
      }),
      logged,
    );
    return { kind: "unavailable", reason: "source" };
  }
  if (
    outcome.provenance !== "rendered" &&
    !(yield* usableExternalAsset(outcome.bytes))
  ) {
    yield* Effect.logDebug("Excerpt payload has no usable pixels").pipe(
      Effect.annotateLogs({
        provenance: outcome.provenance,
        format: outcome.format.format,
        bytes: outcome.bytes.byteLength,
      }),
      logged,
    );
    return { kind: "unavailable", reason: "source" };
  }
  const valid = options.valid ?? Effect.succeed(true);
  const assertCurrent = Effect.gen(function* () {
    if (!(yield* valid))
      return yield* new ExcerptAssetRefused({
        message: "Excerpt insertion target is no longer current",
      });
  });
  const vault = yield* Vault;
  const fs = yield* FileSystem.FileSystem;
  const cleanupFailed = (message: string) =>
    recover(
      (cause) =>
        Effect.logWarning(message).pipe(Effect.annotateLogs({ cause }), logged),
      Effect.void,
    );
  const publish = Effect.gen(function* () {
    yield* assertCurrent;
    const folder = yield* attachmentFolderPath(
      settings["attachment.folder-path"],
      options.notePath,
    );
    const digest = createHash("sha256")
      .update(excerptAssetKey(request))
      .update(outcome.bytes)
      .digest("hex");
    const [identity] = excerptAssetIdentities(request);
    const path = joinFolderPath(
      folder,
      `zotlit-excerpt-${identity}-${digest}.${outcome.format.extension}`,
    );
    const destination = yield* vault.fullPath(path);
    if (destination === null)
      return yield* new ExcerptAssetRefused({
        message: "Excerpt import requires a filesystem vault",
      });
    let created = false;
    const write = Effect.gen(function* () {
      yield* assertCurrent;
      yield* fs.makeDirectory(dirname(destination), { recursive: true });
      const temporary = join(
        dirname(destination),
        `.${basename(destination)}.${randomUUID()}.tmp`,
      );
      yield* Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          removeIgnoringAbsent(temporary).pipe(
            cleanupFailed("Excerpt temporary cleanup failed"),
          ),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const file = yield* fs.open(temporary, { flag: "wx" });
            yield* file.writeAll(outcome.bytes);
            yield* file.sync;
          }),
        );
        yield* assertCurrent;
        yield* Effect.uninterruptible(
          fs.link(temporary, destination).pipe(
            Effect.andThen(
              Effect.sync(() => {
                created = true;
              }),
            ),
            Effect.catchReason(
              "PlatformError",
              "AlreadyExists",
              () => Effect.void,
            ),
          ),
        );
        const actual = yield* fs.readFile(destination);
        if (!Buffer.from(actual).equals(outcome.bytes))
          return yield* new ExcerptAssetRefused({
            message: "Excerpt destination does not match its content identity",
          });
        yield* assertCurrent;
      }).pipe(Effect.scoped);
      yield* assertCurrent;
      yield* vault.reconcileFile(path);
      yield* assertCurrent;
      if (!(yield* vault.getFileByPath(path)))
        return yield* new ExcerptAssetRefused({
          message: "Published excerpt is not registered in the vault",
        });
      const saved: MaterializedExcerpt = { kind: "saved", path, outcome };
      return saved;
    });
    const takeBack = (exit: Exit.Exit<unknown, unknown>) =>
      Effect.gen(function* () {
        if (!created || !Exit.isFailure(exit)) return;
        // oxlint-disable-next-line zotlit-services/interrupt-predicate
        if (!Cause.hasInterrupts(exit.cause) && (yield* valid)) return;
        yield* removeIgnoringAbsent(destination).pipe(
          cleanupFailed("Excerpt rollback cleanup failed"),
        );
      });
    return yield* options.gate(destination)(
      write.pipe(Effect.onExit((exit) => takeBack(exit))),
    );
  });
  return yield* publish.pipe(
    recover(
      (cause) =>
        Effect.logDebug("Excerpt materialization failed").pipe(
          Effect.annotateLogs({ cause }),
          logged,
        ),
      Effect.succeed<MaterializedExcerpt>({
        kind: "unavailable",
        reason: "write",
      }),
    ),
  );
});
