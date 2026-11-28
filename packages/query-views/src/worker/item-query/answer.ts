import { Cause, Data, Effect } from "effect";

import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";
import { readLibraries } from "@zotlit/db/item-query";
import type {
  ItemQueryDatabase,
  ItemQueryDatabaseError,
  ItemQueryLayoutError,
} from "@zotlit/db/item-query";
import {
  listQueryValues,
  AttachmentFileResolver,
  consumeQuery,
  describeQueryCustomFields,
  ITEMS,
} from "@zotlit/item-query";
import type {
  ItemQueryRequest,
  ItemQueryError,
  QueryRow,
  QuerySummary,
  ResolveAttachmentFile,
} from "@zotlit/item-query";
import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";
import { resourceReleaseUrl } from "@zotlit/plugin-kernel/worker/release-url.ts";
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
import { QueryFailed } from "@zotlit/zotero-reads/contract/rpc.ts";

import type {
  Diagnostic,
  LibraryValues,
  QueryCliCommand,
  QueryIdentity,
  QueryOutputFormat,
  LibraryWire,
} from "./contract.ts";
import { DEFAULT_CLI_LIMIT, diagnostic, envelope } from "./contract.ts";
import { CLI_DATASETS } from "./datasets.ts";
import type { EmitPiece } from "./encode.ts";
import { encodeAnswer } from "./encode.ts";
import type {
  QueryViewGroup,
  QueryViewResult,
  QueryViewRow,
} from "./query-view.ts";
import type {
  QueryAnswer,
  QueryCommand,
  QueryCustomFieldsCommand,
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
}

export type QueryInstrument = <A, E, R>(
  operation: Effect.Effect<A, E, R>,
) => Effect.Effect<A, E, R>;

export class TargetLibrariesUnavailable extends Data.TaggedError(
  "TargetLibrariesUnavailable",
)<{
  readonly reason: "named-missing" | "named-none" | "scope-none";
  readonly missing?: LibrarySelector;
}> {}

export type AnswerSummary = {
  readonly ok: true;
  readonly identity: QueryIdentity;
} & Readonly<Record<string, unknown>>;

export interface AnswerSink {
  readonly head: (summary: AnswerSummary) => Effect.Effect<void>;
  readonly emit: EmitPiece<never>;
}

export function encodeCommand(
  job: AnswerJob,
  env: AnswerEnv,
  sink: AnswerSink,
): Effect.Effect<void, AnswerFailure, ItemQueryDatabase> {
  if ("values" in job) return encodeValues(job, env, sink);
  if (job.schema) return encodeSchema(job, env, sink);
  return encodeQuery(job, env, sink);
}

export function queryFailed(job: AnswerJob) {
  const parameter = namedParameter(job);
  return <A, R>(
    run: Effect.Effect<A, AnswerFailure, R>,
  ): Effect.Effect<A, QueryFailed, R> =>
    run.pipe(
      Effect.catch((failed) =>
        Effect.flatMap(failureDiagnostic(failed, parameter), (diagnostic) =>
          Effect.fail(new QueryFailed({ diagnostic })),
        ),
      ),
      Effect.catchDefect((defect) => dieOfDefect(defect)),
    );
}

const namedParameter = (
  job: AnswerJob,
): NamedLibraries["parameter"] | undefined =>
  "values" in job
    ? job.values.libraries?.parameter
    : job.schema
      ? undefined
      : job.query.libraries?.parameter;

function encodeSchema(
  job: Extract<AnswerJob, { schema: true }>,
  env: AnswerEnv,
  sink: AnswerSink,
): Effect.Effect<void, AnswerFailure, ItemQueryDatabase> {
  const { command, pluginVersion } = job;
  const selected = Object.entries(CLI_DATASETS).filter(
    ([id]) => job.dataset === undefined || id === job.dataset,
  );
  return Effect.all([describeQueryCustomFields(ITEMS), env.identity]).pipe(
    Effect.flatMap(([customFields, identity]) => {
      const summary = { ok: true as const, identity };
      return Effect.andThen(
        sink.head(summary),
        sink.emit(
          envelope(command, {
            ...summary,
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
      );
    }),
  );
}

type QueryJobOf = Extract<AnswerJob, { query: DecodedQuery }>;

function encodeQuery(
  job: QueryJobOf,
  env: AnswerEnv,
  sink: AnswerSink,
): Effect.Effect<void, AnswerFailure, ItemQueryDatabase> {
  return runQuery(job, env, (summary, context) =>
    createDocument(summary, context, sink),
  );
}

function runQuery<A, E, R>(
  job: QueryJobOf,
  env: AnswerEnv,
  consume: (
    summary: QuerySummary,
    context: DocumentContext,
  ) => Effect.Effect<
    {
      write: (
        rows: readonly QueryRow[],
        groupIndex?: number,
      ) => Effect.Effect<void, E>;
      end: Effect.Effect<A, E>;
    },
    E,
    R
  >,
) {
  const { command, query: decoded } = job;
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
        consume(summary, {
          command,
          from: decoded.from,
          identity,
          libraries: available.map(({ selector, name }) =>
            selector.type === "group"
              ? { ...selector, name: name ?? "" }
              : selector,
          ),
          format: decoded.export?.format ?? "json",
          onAnswerStep: env.onAnswerStep,
        }),
    ).pipe(
      Effect.provideService(
        AttachmentFileResolver,
        env.attachmentFiles ?? null,
      ),
    );
  });
  return env.instrument?.(operation) ?? operation;
}

export function answerCustomFields(
  command: QueryCustomFieldsCommand["command"],
): Effect.Effect<QueryAnswer, never, ItemQueryDatabase> {
  return describeQueryCustomFields(ITEMS).pipe(
    Effect.map((fields): QueryAnswer => ({
      command,
      customFields: fields.map(({ name }) => name),
    })),
    Effect.catch((failed) =>
      Effect.as(failureDiagnostic(failed, undefined), { command }),
    ),
    Effect.catchDefect((defect) => dieOfDefect(defect)),
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

const encodeValues = (
  job: Extract<AnswerJob, { values: unknown }>,
  env: AnswerEnv,
  sink: AnswerSink,
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
    const summary = {
      ok: true as const,
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
    };
    yield* sink.head(summary);
    yield* emitListings(
      envelope(job.command, { ...summary, values: [] }),
      values,
      sink.emit,
    );
  });

const EMPTY_LIST_END = "[]\n}";

const emitListings = Effect.fnUntraced(function* (
  head: string,
  listings: readonly LibraryValues[],
  emit: EmitPiece<never>,
) {
  if (listings.length === 0) return yield* emit(head);
  yield* emit(`${head.slice(0, -EMPTY_LIST_END.length)}[`);
  for (const [index, listing] of listings.entries()) {
    const separator = index === 0 ? "" : ",";
    const item = indent(
      JSON.stringify({ ...listing, values: [] }, null, 2),
      "    ",
    );
    if (listing.values.length === 0) {
      yield* emit(`${separator}\n    ${item}`);
      continue;
    }
    yield* emit(
      `${separator}\n    ${item.slice(0, -indent(EMPTY_LIST_END, "    ").length)}[`,
    );
    for (const [at, value] of listing.values.entries())
      yield* emit(
        `${at === 0 ? "" : ","}\n        ${indent(JSON.stringify(value, null, 2), "        ")}`,
      );
    yield* emit("\n      ]\n    }");
  }
  yield* emit("\n  ]\n}");
});

const indent = (text: string, by: string) => text.replaceAll("\n", `\n${by}`);

interface DocumentContext {
  from: DecodedQuery["from"];
  command: QueryCliCommand;
  identity: QueryIdentity;
  libraries: readonly LibraryWire[];
  format: QueryOutputFormat;
  onAnswerStep?: (ms: number) => void;
}

function answerSummary(result: QuerySummary, context: DocumentContext) {
  return {
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
}

const createDocument = Effect.fnUntraced(function* (
  result: QuerySummary,
  context: DocumentContext,
  sink: AnswerSink,
) {
  const summary = answerSummary(result, context);
  yield* sink.head(summary);
  const { format } = context;
  return yield* encodeAnswer(
    result,
    format === "json"
      ? {
          format,
          head: envelope(context.command, {
            ...summary,
            ...(result.groups !== undefined ? { groups: [] } : { rows: [] }),
          }),
        }
      : { format },
    { emit: sink.emit, onAnswerStep: context.onAnswerStep },
  );
});

export type AnswerFailure =
  | DbUnavailable
  | ItemQueryError
  | ItemQueryLayoutError
  | ItemQueryDatabaseError
  | TargetLibrariesUnavailable;

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
