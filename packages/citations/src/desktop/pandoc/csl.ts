import type {
  CslStyleFailure,
  ResolvedCslStyle,
} from "#core/pandoc/csl-style.ts";
import type {
  DocumentPresentationFailure,
  StyleSource,
} from "#obsidian/pandoc/document-presentation.ts";
import { Clock, Effect, FileSystem, PlatformError, Schema } from "effect";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";

import { CONTRACT_VERSION } from "#core/pandoc/contract.ts";

export const CSL_COMMAND = "zotlit:csl";

const STORE_DIR = "zotlit-pandoc-csl";

const CSL_EXT = ".csl";

export const CSL_STAGING_EXT = ".part";

export type CslErrorCode =
  | "style-missing"
  | "parent-missing"
  | "style-unreadable"
  | "style-invalid"
  | "csl-write-failed"
  | "flags-invalid"
  | "file-not-found"
  | "style-property-invalid"
  | "language-property-invalid"
  | "profile-unavailable";

export interface CslError {
  code: CslErrorCode;
  styleId?: string;
  parentId?: string;
  message: string;
}

export class CslWriteError extends Schema.TaggedError<CslWriteError>()(
  "CslWriteError",
  {
    styleId: Schema.String,
    parentId: Schema.UndefinedOr(Schema.String),
    cause: Schema.instanceOf(PlatformError.PlatformError),
  },
) {}

export function cslWriteFailedResponse({
  styleId,
  parentId,
  cause,
}: CslWriteError): CslResponse {
  return errorResponse([
    {
      code: "csl-write-failed",
      styleId,
      parentId,
      message: `Cannot write the resolved CSL style of "${styleId}" to "${cslStoreDirectory()}": ${describe(cause)}. Restore write access to that directory, then run the command again.`,
    },
  ]);
}

export type CslResponse = {
  contractVersion: number;
  command: typeof CSL_COMMAND;
} & (
  | {
      styleId: string;
      parentId?: string;
      path: string;
      title: string;
      source?: StyleSource;
    }
  | {
      styleId: null;
      source: StyleSource;
    }
  | { errors: CslError[] }
);

export type DocumentStyleRead =
  | { kind: "read"; styleId: string | null; source: StyleSource }
  | { kind: "file-not-found" }
  | DocumentPresentationFailure;

export interface CslPorts {
  resolve: (
    styleId: string,
  ) => Effect.Effect<ResolvedCslStyle, never, FileSystem.FileSystem>;
  materialize?: (
    xml: string,
  ) => Effect.Effect<
    string,
    PlatformError.PlatformError,
    FileSystem.FileSystem
  >;
}

export interface DocumentCslPorts extends CslPorts {
  readStyle: (absolutePath: string) => Effect.Effect<DocumentStyleRead>;
}

export const resolveDocumentCslStyle = Effect.fn("Csl.resolveDocument")(
  function* (
    absolutePath: string,
    ports: DocumentCslPorts,
  ): Effect.fn.Return<CslResponse, CslWriteError, FileSystem.FileSystem> {
    const read = yield* ports.readStyle(absolutePath);
    if (read.kind === "file-not-found")
      return errorResponse([
        {
          code: "file-not-found",
          message: `No vault note at "${absolutePath}".`,
        },
      ]);
    if (read.kind === "unusable")
      return errorResponse([documentError(read, absolutePath)]);
    const { styleId, source } = read;
    yield* Effect.logDebug("Resolving the style one note selects").pipe(
      Effect.annotateLogs({
        path: absolutePath,
        styleId,
        source: source.kind,
      }),
    );
    if (styleId === null) {
      return {
        contractVersion: CONTRACT_VERSION,
        command: CSL_COMMAND,
        styleId: null,
        source,
      };
    }
    const response = yield* resolveCslStyle(styleId, ports, source);
    return "errors" in response ? response : { ...response, source };
  },
  withLogCategory("pandoc", "csl"),
);

function documentError(
  unusable: DocumentPresentationFailure,
  absolutePath: string,
): CslError {
  switch (unusable.property) {
    case "style":
      return {
        code: "style-property-invalid",
        message: `The zotlit-csl property of "${absolutePath}" holds no CSL style ID. Set it to the ID of a style installed in Zotero, or remove it.`,
      };
    case "language":
      return {
        code: "language-property-invalid",
        message: `The lang property of "${absolutePath}" holds no language tag. Set it to a tag such as en-US, or remove it.`,
      };
    case "profile":
      return {
        code: "profile-unavailable",
        message: `The profile of "${absolutePath}" is unavailable, so the note selects no style. Switch the note to an available profile in Obsidian.`,
      };
    case "profile-style":
      return failure("style-missing", {
        styleId: unusable.styleId,
        source: { kind: "profile", label: unusable.label },
      });
  }
}

function errorResponse(errors: CslError[]): CslResponse {
  return { contractVersion: CONTRACT_VERSION, command: CSL_COMMAND, errors };
}

export const CSL_SELECTOR_MESSAGE =
  'Pass exactly one of style="<csl-id>" or file="<absolute-path>".';

export function flagsInvalidResponse(message: string): CslResponse {
  return errorResponse([{ code: "flags-invalid", message }]);
}

export const resolveCslStyle = Effect.fn("Csl.resolve")(
  function* (
    styleId: string,
    { resolve, materialize = materializeCslStyle }: CslPorts,
    source: StyleSource = { kind: "note" },
  ): Effect.fn.Return<CslResponse, CslWriteError, FileSystem.FileSystem> {
    const style = yield* resolve(styleId);
    if (style.kind !== "installed") {
      return errorResponse([
        style.kind === "failed"
          ? failure(style.reason, { styleId, parentId: style.parentId, source })
          : failure("style-missing", { styleId, source }),
      ]);
    }

    const path = yield* materialize(style.xml).pipe(
      Effect.mapError(
        (cause) =>
          new CslWriteError({
            styleId,
            parentId: style.parentId,
            cause,
          }),
      ),
    );
    yield* Effect.logDebug("Materialized the Resolved CSL Style").pipe(
      Effect.annotateLogs({
        styleId,
        path,
      }),
    );
    return {
      contractVersion: CONTRACT_VERSION,
      command: CSL_COMMAND,
      styleId,
      parentId: style.parentId,
      path,
      title: style.title,
    };
  },
  withLogCategory("pandoc", "csl"),
);

export const materializeCslStyle = Effect.fn("Csl.materialize")(
  function* (xml: string, directory = cslStoreDirectory()) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(directory, { recursive: true });
    const digest = createHash("sha256").update(xml).digest("hex");
    const path = join(directory, `${digest}${CSL_EXT}`);
    const staging = join(
      directory,
      `.${digest}-${randomUUID()}${CSL_STAGING_EXT}`,
    );
    return yield* Effect.scoped(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          fs.remove(staging, { force: true }).pipe(
            Effect.catchTag("PlatformError", (error) =>
              Effect.logWarning("Cannot remove a staged CSL style file").pipe(
                Effect.annotateLogs({
                  staging,
                  error,
                }),
              ),
            ),
          ),
        );
        yield* fs.writeFileString(staging, xml, { flag: "wx" });
        yield* fs
          .link(staging, path)
          .pipe(
            Effect.catchReason("PlatformError", "AlreadyExists", () =>
              restamp(path),
            ),
          );
        return path;
      }),
    );
  },
  withLogCategory("pandoc", "csl"),
);

const restamp = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const now = (yield* Clock.currentTimeMillis) / 1000;
  yield* fs.utimes(path, now, now).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.logDebug("Cannot restamp a materialized CSL style").pipe(
        Effect.annotateLogs({
          path,
          error,
        }),
      ),
    ),
  );
});

export function cslStoreDirectory(parent = tmpdir()): string {
  return join(parent, STORE_DIR);
}

function styleRepair(source: StyleSource): string {
  switch (source.kind) {
    case "note":
      return "correct the zotlit-csl property";
    case "profile":
      return `choose another citation and references style for the ${source.label ?? "default"} profile`;
    case "vault":
      return "choose another citation and references style in the ZotLit settings";
  }
}

const MESSAGES: Record<
  CslStyleFailureCode,
  (styleId: string, parentId: string | undefined, source: StyleSource) => string
> = {
  "style-missing": (styleId, _parentId, source) =>
    `Zotero has no installed CSL style carrying the ID "${styleId}". Install that style in Zotero, or ${styleRepair(source)}.`,
  "parent-missing": (styleId, parentId) =>
    `The CSL style "${styleId}" depends on "${parentId}", which Zotero has not installed. Reinstall "${styleId}" in Zotero so that it brings its independent parent.`,
  "style-unreadable": (styleId) =>
    `A CSL file the style "${styleId}" is read from refuses to be read. Restore read access to the Zotero styles directory, then run the command again.`,
  "style-invalid": (styleId) =>
    `The content behind the CSL style "${styleId}" is no standalone CSL style. Reinstall that style in Zotero.`,
};

const CODES = {
  "style-missing": "style-missing",
  "parent-missing": "parent-missing",
  unreadable: "style-unreadable",
  invalid: "style-invalid",
} as const satisfies Record<CslStyleFailure, CslErrorCode>;

type CslStyleFailureCode = (typeof CODES)[CslStyleFailure];

function failure(
  reason: CslStyleFailure,
  {
    styleId,
    parentId,
    source,
  }: { styleId: string; parentId?: string; source: StyleSource },
): CslError {
  const code = CODES[reason];
  return {
    code,
    styleId,
    parentId,
    message: MESSAGES[code](styleId, parentId, source),
  };
}

function describe(error: unknown): string {
  return Error.isError(error) ? error.message : String(error);
}
