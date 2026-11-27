import type { Scope } from "effect";
import { Cause, Clock, Data, Effect } from "effect";

import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { readLibraries } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  listQueryValues,
  renderDiagnostic,
  AttachmentFileResolver,
  consumeQuery,
  describeQueryCustomFields,
  SLICE_BUDGET_MS,
  ITEMS,
  valueText,
} from "@zotlit/item-query";
import type {
  ItemQueryRequest,
  ItemQueryError,
  ProjectionJson,
  QueryRow,
  QuerySummary,
  ResolveAttachmentFile,
} from "@zotlit/item-query";
import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";
import { resourceReleaseUrl } from "@zotlit/plugin-kernel/worker/release-url.ts";
import { delimitedLines, delimitedStart } from "@zotlit/shared/delimited";
import type { DelimitedFormat } from "@zotlit/shared/delimited";
import type { DbUnavailable } from "@zotlit/zotero-reads/contract/db-unavailable.ts";
import {
  resolveLibraryScope,
  selectorKey,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  LibraryScope,
  LibrarySelector,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  DecodedQuery,
  NamedLibraries,
} from "@zotlit/zotero-reads/contract/query-codec.ts";

import type {
  Diagnostic,
  QueryCliCommand,
  QueryIdentity,
  LibraryWire,
} from "./contract.ts";
import {
  DEFAULT_CLI_LIMIT,
  diagnostic,
  envelope,
  failure,
  INLINE_MAX_BYTES,
} from "./contract.ts";
import { CLI_DATASETS } from "./datasets.ts";
import type {
  QueryViewGroup,
  QueryViewResult,
  QueryViewRow,
} from "./query-view.ts";
import type {
  QueryAnswer,
  QueryCommand,
  QueryCustomFieldsCommand,
  QueryReply,
  QueryViewCommand,
  QueryViewReply,
} from "./worker-protocol.ts";

export type AnswerJob = QueryCommand & {
  scope: LibraryScope;
  uses?: Readonly<Record<string, number>>;
};

export interface AnswerEnv {
  identity: Effect.Effect<QueryIdentity, DbUnavailable>;
  attachmentFiles?: ResolveAttachmentFile;
  instrument?: QueryInstrument;
  onAnswerStep?: (ms: number) => void;
  openOutput?: (
    path: string,
  ) => Effect.Effect<QueryWriter, QueryOutputError, Scope.Scope>;
}

export type QueryInstrument = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R>;

export interface QueryWriter {
  write(text: string): Effect.Effect<number, QueryOutputError>;
}

export class QueryOutputError extends Data.TaggedError("QueryOutputError")<{
  diagnostic: Diagnostic;
}> {}

export class TargetLibrariesUnavailable extends Data.TaggedError(
  "TargetLibrariesUnavailable",
)<{
  readonly reason: "named-missing" | "named-none" | "scope-none";
  readonly missing?: LibrarySelector;
}> {}

export function answer(
  job: AnswerJob,
  env: AnswerEnv,
): Effect.Effect<QueryReply, never, ItemQueryDatabase | Scope.Scope> {
  if ("values" in job) return answerValues(job, env);
  return job.schema
    ? answerSchema(job, env, job.pluginVersion)
    : answerQuery(job, env, job.query);
}

function answerSchema(
  job: AnswerJob,
  env: AnswerEnv,
  pluginVersion: string,
): Effect.Effect<QueryReply, never, ItemQueryDatabase> {
  const { command } = job;
  const selected = Object.entries(CLI_DATASETS).filter(
    ([id]) => job.dataset === undefined || id === job.dataset,
  );
  return Effect.all([describeQueryCustomFields(ITEMS), env.identity]).pipe(
    Effect.map(([customFields, identity]) =>
      inline(
        command,
        envelope(command, {
          ok: true,
          identity,
          schema: {
            url: `${resourceReleaseUrl(RELEASE_REPOSITORY, pluginVersion)}/query.schema.json`,
            fileName: `zotlit-query-${pluginVersion}.schema.json`,
          },
          customFields,
          datasets: Object.fromEntries(
            selected.map(([id, { dataset }]) => [
              id,
              {
                fields: dataset.names,
                customPrefix: dataset.customPrefix,
              },
            ]),
          ),
          defaults: Object.fromEntries(
            selected.map(([id, { dataset }]) => [
              id,
              {
                fields: dataset.defaultFields,
                sort: dataset.defaultSort,
                limit: DEFAULT_CLI_LIMIT,
                library: { source: "library-scope" as const },
              },
            ]),
          ),
        }),
      ),
    ),
    answerFailure(command),
  );
}

function answerQuery(
  job: AnswerJob,
  env: AnswerEnv,
  decoded: DecodedQuery,
): Effect.Effect<QueryReply, never, ItemQueryDatabase | Scope.Scope> {
  const { command } = job;
  const named = decoded.libraries;
  const operation = Effect.gen(function* () {
    const identity = yield* env.identity;
    const available = yield* targetLibraries(named, job.scope);
    const request: ItemQueryRequest = {
      ...(job.uses ? { uses: job.uses } : {}),
      filter: decoded.filter,
      group: decoded.group,
      fields: decoded.fields,
      formulas: decoded.formulas,
      sort: decoded.sort,
      limit: decoded.limit,
      context: decoded.context,
      libraries: available.map(({ libraryID, selector }) => ({
        libraryID,
        groupID: selector.type === "group" ? selector.groupID : null,
      })),
    };
    return yield* consumeQuery(
      CLI_DATASETS[decoded.from].dataset,
      request,
      (summary) =>
        createAnswer(summary, {
          command,
          from: decoded.from,
          identity,
          libraries: available.map(({ selector, name }) =>
            selector.type === "group"
              ? { ...selector, name: name ?? "" }
              : selector,
          ),
          onAnswerStep: env.onAnswerStep,
          output: decoded.output,
          format: decoded.format,
          openOutput: env.openOutput,
        }),
    ).pipe(
      Effect.provideService(
        AttachmentFileResolver,
        env.attachmentFiles ?? null,
      ),
    );
  });
  return (env.instrument?.(operation) ?? operation).pipe(
    answerFailure(command, named?.parameter),
  );
}

export function answerCustomFields(
  command: QueryCustomFieldsCommand["command"],
): Effect.Effect<QueryAnswer, never, ItemQueryDatabase> {
  return describeQueryCustomFields(ITEMS).pipe(
    Effect.map((fields): QueryAnswer => ({
      ...inline(command, ""),
      customFields: fields.map(({ name }) => name),
    })),
    answerFailure(command),
  );
}

export type AnswerViewJob = QueryViewCommand & {
  scope: LibraryScope;
  uses?: Readonly<Record<string, number>>;
};

export function answerView(
  job: AnswerViewJob,
  env: Pick<AnswerEnv, "attachmentFiles">,
): Effect.Effect<QueryViewReply, never, ItemQueryDatabase> {
  const { command, view } = job;
  const named =
    view.libraries === undefined
      ? null
      : { scope: view.libraries, parameter: "library" as const };
  return Effect.gen(function* () {
    const available = yield* targetLibraries(named, job.scope);
    const request: ItemQueryRequest = {
      ...(job.uses ? { uses: job.uses } : {}),
      filter: view.filter,
      group: view.group,
      fields: view.fields,
      formulas: view.formulas,
      onFormulaFault: "leave-out",
      sort: view.sort,
      limit: view.limit ?? null,
      context: view.context,
      libraries: available.map(({ libraryID, selector }) => ({
        libraryID,
        groupID: selector.type === "group" ? selector.groupID : null,
      })),
    };
    const libraries = available.map(({ selector, name }) =>
      selector.type === "group" ? { ...selector, name: name ?? "" } : selector,
    );
    const result = yield* consumeQuery(
      CLI_DATASETS[view.from].dataset,
      request,
      (summary) => Effect.sync(() => collectView(summary, libraries)),
    ).pipe(
      Effect.provideService(
        AttachmentFileResolver,
        env.attachmentFiles ?? null,
      ),
    );
    return viewReply(command, { kind: "result", result });
  }).pipe(
    Effect.catch((failed) =>
      Effect.map(failureDiagnostic(failed, named?.parameter), (diagnostic) =>
        viewReply(command, {
          kind: "failed",
          diagnostic,
          ...(failed._tag === "ItemQueryError" &&
            failed.formulaDiagnostics && {
              formulaDiagnostics: failed.formulaDiagnostics,
            }),
        }),
      ),
    ),
    Effect.catchDefect((defect) => dieOfDefect(defect)),
  );
}

const viewReply = (
  command: QueryCliCommand,
  view: QueryViewReply["view"],
): QueryViewReply => ({
  command,
  answer: "",
  receipt: { kind: "inline" },
  view,
});

function collectView(summary: QuerySummary, libraries: readonly LibraryWire[]) {
  const { groups: summaries, totalCount, ...metadata } = summary;
  const rows: QueryViewRow[] = [];
  const groups = summaries?.map(
    (group): QueryViewGroup & { rows: QueryViewRow[] } => ({
      ...group,
      rows: [],
    }),
  );
  return {
    write: (chunk: readonly QueryRow[], groupIndex?: number) =>
      Effect.sync(() => {
        const target =
          groups && groupIndex !== undefined ? groups[groupIndex]!.rows : rows;
        const wire = JSON.parse(JSON.stringify(chunk)) as QueryViewRow[];
        for (const row of wire) target.push(row);
      }),
    end: Effect.sync((): QueryViewResult =>
      groups
        ? { ...metadata, libraries, totalCount: totalCount!, groups }
        : { ...metadata, libraries, rows },
    ),
  };
}

const targetLibraries = Effect.fnUntraced(function* (
  named: NamedLibraries | null,
  scope: LibraryScope,
) {
  const requireEach = named !== null;
  const libraries = resolveLibraryScope(
    yield* readLibraries,
    named ? named.scope : scope,
  );
  const { available, unavailable } = libraries;
  const [missing] = unavailable;
  if (requireEach && missing) {
    return yield* new TargetLibrariesUnavailable({
      reason: "named-missing",
      missing,
    });
  }
  if (available.length === 0) {
    return yield* new TargetLibrariesUnavailable({
      reason: requireEach ? "named-none" : "scope-none",
    });
  }
  return available;
});

const answerValues = (
  job: Extract<AnswerJob, { values: unknown }>,
  env: AnswerEnv,
) =>
  Effect.gen(function* () {
    const decoded = job.values;
    const available = yield* targetLibraries(decoded.libraries, job.scope);
    const values = [];
    for (const library of available) {
      const listing = yield* listQueryValues(library, decoded);
      values.push({
        library: selectorKey(library.selector),
        name: library.name ?? "My Library",
        ...listing,
      });
    }
    const identity = yield* env.identity;
    const text = envelope(job.command, {
      ok: true,
      identity,
      libraries: available.map(({ selector, name }) =>
        selector.type === "group"
          ? { ...selector, name: name ?? "" }
          : selector,
      ),
      request: {
        kind: decoded.kind,
        library: available.map(({ selector }) => selectorKey(selector)),
        ...(decoded.match === undefined ? {} : { match: decoded.match }),
        limit: decoded.limit,
      },
      returnedCount: values.reduce(
        (count, library) => count + library.returnedCount,
        0,
      ),
      truncated: values.some((library) => library.truncated),
      values,
    });
    if (exceedsInlineLimit(text)) {
      return yield* new QueryOutputError({
        diagnostic: renderDiagnostic({
          ...diagnostic(
            "result-too-large",
            `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`,
          ),
          hint: "Narrow match or reduce limit in zotlit:query-values, then run it again.",
        }),
      });
    }
    return inline(job.command, text);
  }).pipe(answerFailure(job.command, job.values.libraries?.parameter));

export const exportUnavailable = (command: QueryCliCommand): QueryReply =>
  inline(
    command,
    failure(
      command,
      diagnostic(
        "export-unavailable",
        "This library source cannot write an export file.",
        { parameter: "output" },
      ),
    ),
  );

const inline = (command: QueryCliCommand, text: string): QueryReply => ({
  command,
  answer: text,
  receipt: { kind: "inline" },
});

const ANSWER_STEP_BUDGET_MS = SLICE_BUDGET_MS / 2;
const NO_ROWS = "[]\n}";
const CHUNK_START = '{\n  "rows": [';
const CHUNK_END = "\n  ]\n}";
const FIRST_CHUNK_ROWS = 64;
const CHUNK_TEXT_LENGTH = 256 * 1024;

interface AnswerContext {
  from: DecodedQuery["from"];
  command: QueryCliCommand;
  identity: QueryIdentity;
  libraries: readonly LibraryWire[];
  onAnswerStep?: (ms: number) => void;
  output?: string;
  format?: DelimitedFormat;
  openOutput?: AnswerEnv["openOutput"];
}

interface RowsEncoder {
  readonly start: string;
  group(groupIndex: number, previous: number | undefined): string;
  rows(chunk: readonly QueryRow[], groupIndex: number | undefined): string;
  end(lastGroup: number | undefined): string;
}

function jsonRows(result: QuerySummary, head: string): RowsEncoder {
  const grouped = result.groups !== undefined;
  let first = true;
  return {
    start:
      result.returnedCount === 0 ? head : `${head.slice(0, -NO_ROWS.length)}[`,
    group(groupIndex, previous) {
      const group = result.groups![groupIndex]!;
      const header = JSON.stringify({ ...group, rows: [] }, null, 2);
      first = true;
      return `${previous === undefined ? "" : "\n      ]\n    },"}\n    ${header.slice(0, -NO_ROWS.length).replaceAll("\n", "\n    ")}[`;
    },
    rows(chunk) {
      const wire = JSON.stringify({ rows: chunk }, null, 2).slice(
        CHUNK_START.length,
        -CHUNK_END.length,
      );
      const indented = grouped ? wire.replaceAll("\n", "\n    ") : wire;
      const part = first ? indented : `,${indented}`;
      first = false;
      return part;
    },
    end: (lastGroup) =>
      `${lastGroup === undefined ? "" : "\n      ]\n    }"}${result.returnedCount > 0 ? CHUNK_END : ""}`,
  };
}

function delimitedRows(
  result: QuerySummary,
  format: DelimitedFormat,
): RowsEncoder {
  const grouped = result.groups !== undefined;
  const { fields } = result.query;
  const header = [...(grouped ? ["group"] : []), "indexedKey", ...fields];
  return {
    start: delimitedStart(format) + delimitedLines([header], format),
    group: () => "",
    rows(chunk, groupIndex) {
      const group = grouped
        ? [valueText(result.groups[groupIndex!]!.value)]
        : [];
      const wire = JSON.parse(JSON.stringify(chunk)) as readonly {
        indexedKey: string;
        values: Readonly<Record<string, ProjectionJson>>;
      }[];
      return delimitedLines(
        wire.map((row) => [
          ...group,
          row.indexedKey,
          ...fields.map((field) => valueText(row.values[field])),
        ]),
        format,
      );
    },
    end: () => "",
  };
}

const createAnswer = Effect.fnUntraced(function* (
  result: QuerySummary,
  context: AnswerContext,
) {
  const now = monotonicMillis(yield* Clock.Clock);
  const summary = {
    ok: true as const,
    identity: context.identity,
    libraries: context.libraries,
    request: {
      from: context.from,
      library: context.libraries.map(selectorKey),
      ...result.query,
    },
    returnedCount: result.returnedCount,
    truncated: result.truncated,
    ...(result.totalCount === undefined
      ? {}
      : { totalCount: result.totalCount }),
    warnings: result.warnings,
  };
  const grouped = result.groups !== undefined;
  const { output, openOutput, format } = context;
  if (format !== undefined && output === undefined)
    return yield* Effect.die(
      new Error(`ZotLit Query ${format} export has no output path`),
    );
  const encoder =
    format === undefined
      ? jsonRows(
          result,
          envelope(context.command, {
            ...summary,
            ...(grouped ? { groups: [] } : { rows: [] }),
          }),
        )
      : delimitedRows(result, format);
  let activeGroup: number | undefined;
  let text = "";
  let bytes = 0;
  let chunkRows = FIRST_CHUNK_ROWS;
  let file: QueryWriter | undefined;
  if (output !== undefined) {
    if (!openOutput)
      return yield* Effect.die(
        new Error("ZotLit Query export has no file writer"),
      );
    file = yield* openOutput(output);
  }
  const tooLarge = () =>
    Effect.fail(
      new QueryOutputError({
        diagnostic: resultTooLarge(openOutput !== undefined),
      }),
    );
  const append = (chunk: string) =>
    Effect.suspend(() => {
      if (file)
        return Effect.map(file.write(chunk), (written) => {
          bytes += written;
        });
      text += chunk;
      return text.length > INLINE_MAX_BYTES ? tooLarge() : Effect.void;
    });
  yield* append(encoder.start);
  return {
    write: Effect.fnUntraced(function* (
      rows: readonly QueryRow[],
      groupIndex?: number,
    ) {
      if (grouped && groupIndex !== activeGroup) {
        yield* append(encoder.group(groupIndex!, activeGroup));
        activeGroup = groupIndex;
      }
      let stepMs = 0;
      for (let start = 0; start < rows.length;) {
        const stepStart = now();
        const chunk = rows.slice(start, start + chunkRows);
        const part = encoder.rows(chunk, groupIndex);
        start += chunk.length;
        chunkRows = Math.max(
          1,
          Math.ceil(CHUNK_TEXT_LENGTH / (part.length / chunk.length)),
        );
        stepMs += now() - stepStart;
        yield* append(part);
        if (stepMs < ANSWER_STEP_BUDGET_MS) continue;
        context.onAnswerStep?.(stepMs);
        stepMs = 0;
      }
      context.onAnswerStep?.(stepMs);
    }),
    end: Effect.gen(function* () {
      yield* append(encoder.end(activeGroup));
      if (output === undefined)
        return exceedsInlineLimit(text)
          ? yield* tooLarge()
          : inline(context.command, text);
      return {
        command: context.command,
        answer: envelope(context.command, {
          ...summary,
          file: { path: output, bytes, format: format ?? "json" },
        }),
        receipt: { kind: "file", path: output, bytes },
      } satisfies QueryReply;
    }),
  };
});

type AnswerFailure =
  | DbUnavailable
  | ItemQueryError
  | ItemQueryLayoutError
  | ItemQueryDatabaseError
  | QueryOutputError
  | TargetLibrariesUnavailable;

function answerFailure(
  command: QueryCliCommand,
  parameter?: NamedLibraries["parameter"],
) {
  return <R>(
    run: Effect.Effect<QueryReply, AnswerFailure, R>,
  ): Effect.Effect<QueryReply, never, R> =>
    run.pipe(
      Effect.catch((failed) =>
        Effect.map(failureDiagnostic(failed, parameter), (diagnostic) =>
          inline(command, failure(command, diagnostic)),
        ),
      ),
      Effect.catchDefect((defect) => dieOfDefect(defect)),
    );
}

const dieOfDefect = (defect: unknown): Effect.Effect<never> =>
  Effect.logError("ZotLit Query failed with a defect").pipe(
    Effect.annotateLogs({
      cause: Cause.pretty(Cause.die(defect)),
    }),
    withLogCategory("item-query"),
    Effect.andThen(
      Effect.die(
        new Error("ZotLit Query failed with an internal error.", {
          cause: defect,
        }),
      ),
    ),
  );

function failureDiagnostic(
  failed: AnswerFailure,
  parameter: NamedLibraries["parameter"] | undefined,
): Effect.Effect<Diagnostic> {
  if (failed._tag === "QueryOutputError")
    return Effect.succeed(failed.diagnostic);
  if (failed._tag === "TargetLibrariesUnavailable")
    return Effect.succeed(targetLibrariesFailure(failed, parameter));
  if (failed._tag === "ItemQueryError")
    return Effect.succeed(failed.diagnostic);
  if (failed._tag === "DbUnavailable")
    return Effect.succeed(
      diagnostic(
        "database-error",
        `ZotLit Query could not read the Zotero database: ${failed.message}`,
      ),
    );
  if (failed._tag === "ItemQueryLayoutError") {
    return Effect.succeed(
      diagnostic("unsupported-database-layout", failed.message),
    );
  }
  return Effect.logError(
    "ZotLit Query failed to read the Zotero database",
  ).pipe(
    Effect.annotateLogs({ error: failed }),
    withLogCategory("item-query"),
    Effect.as(
      diagnostic(
        "database-error",
        `ZotLit Query could not read the Zotero database: ${messageOf(failed.cause)}`,
      ),
    ),
  );
}

function targetLibrariesFailure(
  { reason, missing }: TargetLibrariesUnavailable,
  parameter: NamedLibraries["parameter"] | undefined,
): Diagnostic {
  if (reason === "named-missing" && missing) {
    return diagnostic(
      "library-not-found",
      `The connected Zotero source holds no ${describeSelector(missing)}.`,
      parameter && { parameter },
    );
  }
  if (reason === "named-none") {
    return diagnostic(
      "source-unavailable",
      "The connected Zotero source holds no Library.",
    );
  }
  return diagnostic(
    "no-library-available",
    "The connected Zotero source holds no Library of the Library Scope.",
  );
}

function describeSelector(selector: LibrarySelector): string {
  return selector.type === "group"
    ? `group Library with the group ID ${selector.groupID}`
    : "personal Library";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const inlineEncoder = new TextEncoder();

export function exceedsInlineLimit(text: string): boolean {
  return (
    text.length > INLINE_MAX_BYTES ||
    inlineEncoder.encode(text).byteLength > INLINE_MAX_BYTES
  );
}

function resultTooLarge(writesFiles: boolean): Diagnostic {
  const message = `The JSON response exceeds the inline limit of ${INLINE_MAX_BYTES} bytes.`;
  return writesFiles
    ? diagnostic("result-too-large", message)
    : renderDiagnostic({
        ...diagnostic("result-too-large", message),
        hint: "Reduce the fields or the limit, then run the query again.",
      });
}
