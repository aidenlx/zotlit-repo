import {
  Clock,
  Context,
  DateTime,
  Deferred,
  Effect,
  Exit,
  Layer,
  PubSub,
  Scope,
  Stream,
} from "effect";
import type { Duration } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";

import { createFixtureSchema } from "@zotlit/db-testing";
import { createClient } from "@zotlit/db/client/node";
import type { NodeDatabaseClient } from "@zotlit/db/client/node";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { toInstant } from "@zotlit/plugin-kernel/effect-clock.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import {
  layerQueryClients,
  QueryClients,
} from "@zotlit/plugin-services/core/query-client/service.ts";
import type { WireTag } from "@zotlit/plugin-services/core/zotero-local-api/wire.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import {
  annotationItem,
  annotationPage,
  createAccepted,
  createRefused,
  localApiClient,
  notFound,
  rootOk,
  ROUGIER_ANNOTATIONS,
  SERVER_ID,
  testClockAtNow,
  staleVersion,
  staleVersionPatch,
  unreachable,
  writeAccepted,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/__fixtures__.ts";
import type {
  ClientOptions,
  WireAnnotation,
  ZoteroAnswers,
  ZoteroRequest,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/__fixtures__.ts";
import { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import {
  inProcessReadsService,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type {
  ZoteroReadLease,
  ZoteroReadsEvent,
} from "@zotlit/zotero-reads/client/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { ExcerptImageService } from "#obsidian/excerpt-image/service.ts";
import type { AvailableExcerpt } from "#obsidian/excerpt-image/service.ts";

import type {
  AnnotationList,
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";
import { layerAnnotationRepository, AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import type { GeometryEdit, TextField } from "#obsidian/annotation-repository/write.ts";

export const NOW = toInstant(DateTime.makeUnsafe("2026-09-16T15:52:21Z"));

export const FIXTURE_ROWS = `
  insert into items (itemID, itemTypeID, dateAdded, dateModified, libraryID, key)
    values
      (46, 1, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RUGIER24'),
      (47, 2, '2025-02-04 12:00:00', '2025-02-04 12:00:00', 1, 'RGRPDF24'),
      (48, 4, '2026-08-23 16:17:50', '2026-08-23 16:17:50', 1, 'PUPR5FG5'),
      (49, 4, '2026-08-23 16:18:01', '2026-08-23 16:18:01', 1, 'FDRFQ7C2'),
      (50, 4, '2026-08-23 16:18:11', '2026-08-23 16:18:11', 1, 'K3JRFLFQ'),
      (51, 4, '2026-08-23 16:18:18', '2026-08-23 16:19:07', 1, 'HRK7BG32'),
      (52, 4, '2026-08-23 16:19:19', '2026-08-23 16:19:30', 1, 'C94NJNYG'),
      (55, 4, '2026-08-23 16:20:09', '2026-08-23 16:20:21', 1, 'TYY6Z6ZF'),
      (56, 4, '2026-08-23 16:20:12', '2026-08-23 16:20:18', 1, '4PE492KU'),
      (70, 2, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'EPUBBKS2'),
      (71, 4, '2025-02-19 12:00:00', '2025-02-19 12:00:00', 1, 'EPUBMRK2');

  insert into itemAttachments (itemID, parentItemID, linkMode, contentType, path)
    values
      (47, 46, 2, 'application/pdf', 'attachments/rougier-2014.pdf'),
      (70, null, 0, 'application/epub+zip', 'storage:reader.epub');

  insert into itemAnnotations
    (itemID, parentItemID, type, text, comment, color, pageLabel, sortIndex, position, isExternal)
    values
      (48, 47, 1, 'Identify Your Message', null, '#2ea8e5', '1',
        '00000|002041|00170',
        '{"pageIndex":0,"rects":[[265.833,611.202,374.503,620.019]]}', 0),
      (49, 47, 3, null, null, '#ffd400', '2',
        '00001|001860|00047',
        '{"pageIndex":1,"rects":[[48.75,395.509,570,743.723]]}', 0),
      (50, 47, 5,
        'Scientific visualization is classically defined as the process of graphically displaying scientific data.',
        null, '#ff6666', '1', '00000|000434|00180',
        '{"pageIndex":0,"rects":[[67.011,612.638,211.485,620.77],[58.054,601.98,211.489,610.112],[58.054,591.321,153.781,599.454]]}', 0),
      (51, 47, 6, null, 'Making figures is hard :(', '#a28ae5', '1',
        '00000|000191|00088',
        '{"pageIndex":0,"fontSize":14,"rotation":0,"rects":[[398.804,685.107,560.804,702.107]]}', 0),
      (52, 47, 2, null, 'some text comment', '#ffd400', '1',
        '00000|003354|00170',
        '{"pageIndex":0,"rects":[[566.901,598.393,588.901,620.393]]}', 0),
      (55, 47, 4, null, null, '#5fb236', '1', '00000|000040|00100',
        '{"pageIndex":0,"width":2,"paths":[[66.964,674.348,66.629,673.26,66.629,672.214]]}', 0),
      (56, 47, 4, null, null, '#f19837', '1', '00000|000067|00104',
        '{"pageIndex":0,"width":2,"paths":[[203.571,673.009,204.45,672.256,205.266,671.628]]}', 0),
      (71, 70, 1, 'A paragraph in a reflowable book', null, '#ffd400', null,
        '00000|000000|00000',
        '{"type":"FragmentSelector","value":"epubcfi(/6/4!/4/2)"}', 0);
`;

export const REMEMBERED_KEY = "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf";

export async function writable(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = {},
  options: {
    key?: string;
    writeToken?: () => string;
    external?: readonly string[];
  } = {},
) {
  const { writeToken, external } = options;
  const key = "key" in options ? options.key : REMEMBERED_KEY;
  const harness = await setup(
    stack,
    {
      children: () => annotationPage(ROUGIER_ANNOTATIONS),
      item: () => annotationItem(afterWrite("PUPR5FG5", { color: "#ff6666" })),
      ...answers,
    },
    { key, writeToken, external },
  );
  await switchToLocalApi(harness.repository);
  await harness.repository.read("RGRPDF24");
  return harness;
}

export function afterWrite(
  key: string,
  patch: Partial<WireAnnotation>,
): WireAnnotation {
  const record = ROUGIER_ANNOTATIONS.find((entry) => entry.key === key);
  if (!record) throw new Error(`No fixture annotation ${key}`);
  return { ...record, ...patch };
}

export async function switchToLocalApi(
  repository: RepositoryClient,
): Promise<void> {
  const announced = nextChange(repository);
  await repository.read("RGRPDF24");
  await announced;
}

export async function setup(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = { root: unreachable },
  options: ClientOptions & {
    writeToken?: () => string;
    persistedExcerpt?: (
      annotation: AnnotationRecord,
      source: AnnotationSource,
    ) => Promise<string | null>;
    external?: readonly string[];
    group?: GroupLibrary;
  } = {},
) {
  const {
    writeToken,
    persistedExcerpt,
    external = [],
    group,
    ...clientOptions
  } = options;
  const client = createClient(":memory:");
  stack.defer(() => client.$client.close());
  createFixtureSchema(client.$client);
  client.$client.exec(FIXTURE_ROWS);
  for (const key of external) markExternal(client, key);
  client.$client.exec(
    `insert into version (schema, version) values ('userdata', 129), ('compatibility', 9);
     insert into libraries (libraryID, type, version, clientVersion) values (1, 'user', 0, 37);
     update items set version = 0, clientVersion = 29 where itemID = 48;
     insert into settings (setting, key, value) values ('localAPI', 'serverID', '${SERVER_ID}');`,
  );
  if (group) moveToGroup(client, group);

  const reads = stack.use(inProcessReadsService(sharedClientOpener(client)));
  const acquireRead = vi.fn(() => reads.acquireRead());
  const refresh = vi.fn(() => Promise.resolve());
  const dbBus = Effect.runSync(PubSub.unbounded<ZoteroReadsEvent>());
  stack.defer(() => Effect.runSync(PubSub.shutdown(dbBus)));
  const dbEvents = {
    emit: (_event: "changed") => {
      PubSub.publishUnsafe(dbBus, { _tag: "changed" });
    },
  };
  const unavailable = (error: unknown) =>
    error instanceof DbUnavailable
      ? error
      : new DbUnavailable({
          message: error instanceof Error ? error.message : String(error),
        });
  const readsService = stubService<ZoteroReads["Service"]>("ZoteroReads", {
    snapshot: Effect.acquireDisposable(
      Effect.tryPromise({
        try: () => acquireRead(),
        catch: unavailable,
      }),
    ).pipe(Effect.map((lease) => lease.reads)),
    refresh: Effect.tryPromise({
      try: () => refresh(),
      catch: unavailable,
    }),
    events: Stream.fromPubSub(dbBus),
  });

  const {
    disposable: localApiDisposable,
    service: localApiService,
    bridge: localApiBridge,
    requests,
    serverEvents,
    prefEvents,
  } = await localApiClient(answers, clientOptions);
  stack.use(localApiDisposable);
  const pref = Layer.succeed(
    ZoteroPref,
    stubService<ZoteroPref["Service"]>("ZoteroPref", {
      current: Effect.succeed({
        dataDir: "/Zotero",
        baseAttachmentPath: null,
      } as ZoteroPrefSnapshot),
    }),
  );
  const excerptBaselines = vi.fn();
  const excerptImages = stubService<ExcerptImageService["Service"]>(
    "ExcerptImageService",
    {
      stored: ({ annotation, source }) =>
        Effect.promise(async () => {
          excerptBaselines();
          if (!persistedExcerpt) return null;
          const fingerprint = await persistedExcerpt(annotation, source);
          return fingerprint === null
            ? null
            : ({ identity: { fingerprint } } as AvailableExcerpt);
        }),
    },
  );

  const runtime = buildRuntime(
    Layer.mergeAll(
      Layer.succeed(ZoteroReads, readsService),
      layerQueryClients,
      Layer.succeed(ZoteroLocalApi, localApiService),
      Layer.succeed(ExcerptImageService, excerptImages),
      pref,
    ).pipe(Layer.provideMerge(testClockAtNow)),
    stack,
  );
  const dependencies = await runtime.context();
  const repositoryScope = Scope.forkUnsafe(runtime.scope, "parallel");
  const closeRepository = () =>
    runtime.runPromise(Scope.close(repositoryScope, Exit.void));
  stack.defer(closeRepository);
  const repositoryContext = await runtime.runPromise(
    Layer.buildWithScope(
      layerAnnotationRepository({ writeToken }).pipe(
        Layer.provide(Layer.succeedContext(dependencies)),
      ),
      repositoryScope,
    ),
  );
  const service = Context.get(repositoryContext, AnnotationRepository);
  const bridge = effectBridge(runtime);
  const repository = repositoryClient(service, bridge, closeRepository);
  const queryClient = Object.assign(runtime.runSync(QueryClients), {
    bridge,
    runtime,
  });
  const layerClock = Context.get(dependencies, Clock.Clock);
  const adjustLayerClock = (duration: Duration.Input) =>
    TestClock.adjust(duration).pipe(
      Effect.provideService(Clock.Clock, layerClock),
    );
  return {
    repository,
    service,
    runtime,
    adjustLayerClock,
    client,
    db: { acquireRead, refresh },
    dbEvents,
    acquireRead,
    excerptBaselines,
    queryClient,
    localApiService,
    localApiBridge,
    bridge,
    requests,
    serverEvents,
    prefEvents,
  };
}

export const scopedStack = Effect.acquireRelease(
  Effect.sync(() => new AsyncDisposableStack()),
  (stack) => Effect.promise(() => stack.disposeAsync()),
);

export function eventually<A, E, R>(
  read: Effect.Effect<A, E, R>,
  done: (value: A) => boolean,
): Effect.Effect<A, E, R> {
  return Effect.yieldNow.pipe(
    Effect.andThen(read),
    Effect.repeat({ until: done }),
  );
}

export function settledDraft(
  service: AnnotationRepository["Service"],
  field: TextField,
  annotationKey = "PUPR5FG5",
) {
  return eventually(
    service.textDraftFor(field, annotationKey),
    (draft) => !draft,
  );
}

type FixtureEvents = {
  "annotations-changed": (attachmentKey: string) => void;
  "excerpt-pixels-changed": (
    record: AnnotationRecord,
    source: AnnotationSource,
  ) => void;
  "capability-changed": () => void;
  "annotation-changed": (annotationKey: string) => void;
  "history-changed": (attachmentKey: string) => void;
  "write-conflict": (annotationKey: string, attachmentKey: string) => void;
};

type PromiseMember =
  | "createAnnotation"
  | "deleteAnnotation"
  | "deleteAnnotations"
  | "patchColor"
  | "patchColors"
  | "patchComment"
  | "patchGeometry"
  | "read"
  | "redo"
  | "refresh"
  | "retryTextDraft"
  | "retryWrite"
  | "submitTags"
  | "submitTextField"
  | "undo";

type Shape = AnnotationRepository["Service"];

type PlainMembers = {
  [K in Exclude<keyof Shape, "capability" | "probe">]: Shape[K] extends (
    ...args: infer P
  ) => Effect.Effect<infer A, unknown>
    ? (...args: P) => K extends PromiseMember ? Promise<A> : A
    : never;
} & {
  readonly capability: Effect.Success<Shape["capability"]>;
  probe(): Promise<void>;
};

export type RepositoryClient = PlainMembers & {
  listen<K extends keyof FixtureEvents>(
    event: K,
    callback: FixtureEvents[K],
  ): () => void;
} & AsyncDisposable;

const PROMISE_MEMBERS = new Set<PropertyKey>([
  "createAnnotation",
  "deleteAnnotation",
  "deleteAnnotations",
  "patchColor",
  "patchColors",
  "patchComment",
  "patchGeometry",
  "probe",
  "read",
  "redo",
  "refresh",
  "retryTextDraft",
  "retryWrite",
  "submitTags",
  "submitTextField",
  "undo",
]);

export function repositoryClient(
  service: AnnotationRepository["Service"],
  bridge: EffectBridge,
  dispose: () => Promise<void>,
): RepositoryClient {
  return new Proxy({} as RepositoryClient, {
    get(_target, property) {
      if (property === Symbol.asyncDispose) return dispose;
      if (property === "listen") {
        return <K extends keyof FixtureEvents>(
          event: K,
          callback: FixtureEvents[K],
        ): (() => void) => {
          switch (event) {
            case "annotations-changed":
              return bridge.subscribe(service.annotationsChanged, (key) =>
                (callback as FixtureEvents["annotations-changed"])(key),
              );
            case "excerpt-pixels-changed":
              return bridge.subscribe(
                service.excerptPixelsChanged,
                ({ record, source }) =>
                  (callback as FixtureEvents["excerpt-pixels-changed"])(
                    record,
                    source,
                  ),
              );
            case "capability-changed":
              return bridge.subscribe(service.capabilityChanges, () =>
                (callback as FixtureEvents["capability-changed"])(),
              );
            case "annotation-changed":
              return bridge.subscribe(service.annotationChanged, (key) =>
                (callback as FixtureEvents["annotation-changed"])(key),
              );
            case "history-changed":
              return bridge.subscribe(service.historyChanged, (key) =>
                (callback as FixtureEvents["history-changed"])(key),
              );
            case "write-conflict":
              return bridge.subscribe(service.writeConflicts, (conflict) =>
                (callback as FixtureEvents["write-conflict"])(
                  conflict.annotationKey,
                  conflict.attachmentKey,
                ),
              );
          }
        };
      }
      if (property === "capability") return bridge.runSync(service.capability);
      if (property === "probe") return () => bridge.runPromise(service.probe);
      const member = service[property as keyof typeof service];
      if (typeof member !== "function") return member;
      return (...args: unknown[]): unknown => {
        const effect = (
          member as (...args: unknown[]) => Effect.Effect<unknown>
        )(...args);
        return PROMISE_MEMBERS.has(property)
          ? bridge.runPromise(effect)
          : bridge.runSync(effect);
      };
    },
  });
}

export function useFakeTimers(): void {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
}

export function leaseOver(
  stack: AsyncDisposableStack,
  client: ReturnType<typeof createClient>,
): Promise<ZoteroReadLease> {
  return stack
    .use(inProcessReadsService(sharedClientOpener(client)))
    .acquireRead();
}

export function markExternal(
  client: ReturnType<typeof createClient>,
  key: string,
): void {
  client.$client
    .prepare(
      "update itemAnnotations set isExternal = 1 where itemID = (select itemID from items where key = ?)",
    )
    .run(key);
}

export const GROUP_ID = 4711;

export const GROUP_ATTACHMENT = `RGRPDF24g${GROUP_ID}`;

export interface GroupLibrary {
  createdBy: Readonly<Record<string, number | null>>;
  userID?: number;
}

function moveToGroup(
  client: ReturnType<typeof createClient>,
  { createdBy, userID }: GroupLibrary,
): void {
  const db = client.$client;
  db.exec(
    `insert into libraries (libraryID, type, version, clientVersion) values (2, 'group', 0, 37);
     insert into groups (groupID, libraryID) values (${GROUP_ID}, 2);
     update items set libraryID = 2 where itemID between 46 and 56;`,
  );
  const users = new Set(
    [...Object.values(createdBy), userID].filter((id) => id != null),
  );
  for (const id of users)
    db.prepare("insert into users (userID, name) values (?, ?)").run(
      id,
      `user-${id}`,
    );
  for (const [key, creator] of Object.entries(createdBy))
    db.prepare(
      "insert into groupItems (itemID, createdByUserID) values ((select itemID from items where key = ?), ?)",
    ).run(key, creator);
  if (userID !== undefined)
    db.prepare(
      "insert into settings (setting, key, value) values ('account', 'userID', ?)",
    ).run(userID);
}

export function collect<A>(
  stream: Stream.Stream<A>,
  push: (value: A) => Effect.Effect<unknown>,
) {
  return Effect.forkChild(
    Stream.runForEach(stream, (value) => push(value)),
    {
      startImmediately: true,
    },
  );
}

export function nextChange(
  repository: RepositoryClient,
): Promise<readonly string[]> {
  return new Promise((resolve) => {
    const announced: string[] = [];
    const off = repository.listen("annotations-changed", (key) => {
      announced.push(key);
      queueMicrotask(() => {
        off();
        resolve(announced);
      });
    });
  });
}

export function nextChangeOf(
  service: Shape,
): Effect.Effect<Effect.Effect<readonly string[]>> {
  const announced: string[] = [];
  return Effect.flatMap(Deferred.make<void>(), (first) =>
    collect(service.annotationsChanged, (key) =>
      Effect.sync(() => announced.push(key)).pipe(
        Effect.andThen(Deferred.succeed(first, undefined)),
      ),
    ).pipe(
      Effect.as(
        Deferred.await(first).pipe(
          Effect.andThen(Effect.yieldNow),
          Effect.map((): readonly string[] => announced),
        ),
      ),
    ),
  );
}

export const switchServiceToLocalApi = Effect.fnUntraced(function* (
  service: Shape,
  attachmentKey = "RGRPDF24",
) {
  const announced = yield* nextChangeOf(service);
  yield* service.read(attachmentKey);
  yield* announced;
});

export function zoteroLibrary(
  seed: readonly WireAnnotation[] = ROUGIER_ANNOTATIONS,
) {
  const held = new Map<string, WireAnnotation>(
    seed.map((entry) => [entry.key, { ...entry }]),
  );
  const generated = ["MADE2345", "MADE2346", "MADE2347", "MADE2348"];
  let made = 0;
  let next: ((request: ZoteroRequest) => Promise<Response> | Response) | null =
    null;
  let hold: Promise<void> | null = null;
  let running = true;
  const keyOf = ({ url }: ZoteroRequest): string =>
    url.pathname.split("/").at(-1) ?? "";
  const storedTags = (tags: Required<WireTag>[]) =>
    tags.map(({ tag, type }) => (type === 0 ? tag : { tag, type }));
  const create = (request: ZoteroRequest): Response => {
    const [body] = JSON.parse(request.body ?? "[]") as {
      annotationType: string;
      annotationText?: string;
      annotationComment: string;
      annotationColor: string;
      annotationPageLabel: string;
      annotationSortIndex: string;
      annotationPosition: string;
      tags?: Required<WireTag>[];
    }[];
    const key = generated[made++];
    if (!body || key === undefined) return createRefused();
    const [, , library, groupID] = request.url.pathname.split("/");
    const record: WireAnnotation = {
      key,
      ...(library === "groups" && { groupID: Number(groupID) }),
      version: 60 + made,
      type: body.annotationType,
      ...(body.annotationText !== undefined && { text: body.annotationText }),
      comment: body.annotationComment,
      color: body.annotationColor,
      pageLabel: body.annotationPageLabel,
      sortIndex: body.annotationSortIndex,
      position: JSON.parse(body.annotationPosition),
      ...(body.tags !== undefined && { tags: storedTags(body.tags) }),
    };
    held.set(key, record);
    return createAccepted(record);
  };
  const patch = (request: ZoteroRequest): Response => {
    const key = keyOf(request);
    const entry = held.get(key);
    const body = JSON.parse(request.body ?? "{}") as {
      annotationColor?: string;
      annotationComment?: string;
      annotationPosition?: string;
      annotationSortIndex?: string;
      annotationText?: string;
      tags?: Required<WireTag>[];
    };
    if (entry) {
      held.set(key, {
        ...entry,
        ...(body.annotationColor !== undefined && {
          color: body.annotationColor,
        }),
        ...(body.annotationComment !== undefined && {
          comment: body.annotationComment,
        }),
        ...(body.annotationPosition !== undefined && {
          position: JSON.parse(body.annotationPosition) as unknown,
        }),
        ...(body.annotationSortIndex !== undefined && {
          sortIndex: body.annotationSortIndex,
        }),
        ...(body.annotationText !== undefined && { text: body.annotationText }),
        ...(body.tags !== undefined && { tags: storedTags(body.tags) }),
        version: entry.version + 1,
      });
    }
    return writeAccepted();
  };
  return {
    answers: {
      root: () => (running ? rootOk() : unreachable()),
      children: () => annotationPage([...held.values()]),
      item: (request) => {
        const entry = held.get(keyOf(request));
        return entry ? annotationItem(entry) : notFound();
      },
      write: async (request) => {
        if (hold) await hold;
        const answer = next;
        next = null;
        if (answer) return await answer(request);
        if (request.method === "POST") return create(request);
        if (request.method === "DELETE") {
          const key = keyOf(request);
          if (!held.has(key)) return notFound();
          held.delete(key);
          return writeAccepted();
        }
        return patch(request);
      },
    } satisfies ZoteroAnswers,
    at(key: string): WireAnnotation | null {
      return held.get(key) ?? null;
    },
    changeInZotero(key: string, patch: Partial<WireAnnotation>): void {
      const entry = held.get(key);
      if (entry)
        held.set(key, { ...entry, ...patch, version: entry.version + 1 });
    },
    eraseInZotero(key: string): void {
      held.delete(key);
    },
    quit(): void {
      running = false;
    },
    restoreInZotero(key: string): void {
      const entry = seed.find((candidate) => candidate.key === key);
      if (entry) held.set(key, { ...entry, version: entry.version + 1 });
    },
    answerNextWrite(
      answer: (request: ZoteroRequest) => Promise<Response> | Response,
    ): void {
      next = answer;
    },
    holdWrites(): () => void {
      const { promise, resolve } = Promise.withResolvers<void>();
      hold = promise;
      return () => {
        hold = null;
        resolve();
      };
    },
  };
}

type ReadCounters = Pick<
  Awaited<ReturnType<typeof setup>>,
  "acquireRead" | "excerptBaselines"
>;

export function clearReads(counters: ReadCounters): void {
  counters.acquireRead.mockClear();
  counters.excerptBaselines.mockClear();
}

export function batchReads(counters: ReadCounters): number {
  return (
    counters.acquireRead.mock.calls.length -
    counters.excerptBaselines.mock.calls.length
  );
}

const READING_ORDER = [
  ["TYY6Z6ZF", "ink"],
  ["4PE492KU", "ink"],
  ["HRK7BG32", "text"],
  ["K3JRFLFQ", "underline"],
  ["PUPR5FG5", "highlight"],
  ["C94NJNYG", "note"],
  ["FDRFQ7C2", "image"],
];

const DATABASE_SOURCE = {
  kind: "zotero-db",
  database: { userID: null, localUserKey: null, serverID: SERVER_ID },
  libraryID: 1,
  libraryRevision: 37,
} as const;

const DRAFT = {
  type: "highlight",
  color: "#FFD400",
  comment: "",
  text: "Identify Your Message",
  pageLabel: "1",
  sortIndex: "00000|002041|00170",
  position: {
    pageIndex: 0,
    rects: [[265.833_4, 611.202_4, 374.503_4, 620.019_4]],
  },
} as const;

const MADE: WireAnnotation = {
  key: "MADE2345",
  version: 42,
  type: "highlight",
  text: "Identify Your Message",
  color: "#ffd400",
  pageLabel: "1",
  sortIndex: "00000|002041|00170",
  position: { pageIndex: 0, rects: [[265.833, 611.202, 374.503, 620.019]] },
};

function colorOf(list: AnnotationList | null, key: string): string | null {
  return list?.annotations.find((record) => record.key === key)?.color ?? null;
}

function annotationRows(client: NodeDatabaseClient): unknown[] {
  return client.$client
    .prepare("select * from itemAnnotations order by itemID")
    .all();
}

function zoteroHolding(annotationKey: string) {
  const held = new Map<string, WireAnnotation>(
    ROUGIER_ANNOTATIONS.map((entry) => [entry.key, { ...entry }]),
  );
  if (!held.has(annotationKey)) {
    throw new Error(`No fixture annotation ${annotationKey}`);
  }
  let refuseOnce = false;
  const list = () =>
    ROUGIER_ANNOTATIONS.flatMap((entry) => {
      const stored = held.get(entry.key);
      return stored ? [stored] : [];
    });
  const keyOf = ({ url }: ZoteroRequest) =>
    url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
  return {
    answers: {
      children: () => annotationPage(list()),
      item: (request) => {
        const stored = held.get(keyOf(request));
        return stored ? annotationItem(stored) : notFound();
      },
      write: (request) => {
        if (refuseOnce) {
          refuseOnce = false;
          return staleVersion();
        }
        const key = keyOf(request);
        const stored = held.get(key);
        const { annotationColor, annotationComment, annotationText } =
          JSON.parse(request.body ?? "{}") as {
            annotationColor?: string;
            annotationComment?: string;
            annotationText?: string;
          };
        const patched =
          typeof annotationColor === "string" ||
          typeof annotationComment === "string" ||
          typeof annotationText === "string";
        if (stored && patched) {
          held.set(key, {
            ...stored,
            ...(typeof annotationColor === "string" && {
              color: annotationColor,
            }),
            ...(typeof annotationComment === "string" && {
              comment: annotationComment,
            }),
            ...(typeof annotationText === "string" && {
              text: annotationText,
            }),
            version: stored.version + 1,
          });
        }
        return writeAccepted();
      },
    } satisfies ZoteroAnswers,
    get held(): WireAnnotation | null {
      return held.get(annotationKey) ?? null;
    },
    heldOf(key: string): WireAnnotation | null {
      return held.get(key) ?? null;
    },
    changeInZotero(patch: Partial<WireAnnotation>): void {
      const stored = held.get(annotationKey);
      if (stored) {
        held.set(annotationKey, {
          ...stored,
          ...patch,
          version: stored.version + 1,
        });
      }
    },
    eraseInZotero(): void {
      held.delete(annotationKey);
    },
    refuseNextWrite(): void {
      refuseOnce = true;
    },
  };
}

const MOVES: Readonly<Record<string, readonly GeometryEdit[]>> = {
  PUPR5FG5: [
    {
      position: { pageIndex: 0, rects: [[265.833, 610.202, 374.503, 619.019]] },
      sortIndex: "00000|002042|00170",
    },
    {
      position: { pageIndex: 0, rects: [[265.833, 609.202, 374.503, 618.019]] },
      sortIndex: "00000|002043|00170",
    },
  ],
  K3JRFLFQ: [
    {
      position: {
        pageIndex: 0,
        rects: [
          [67.011, 611.638, 211.485, 619.77],
          [58.054, 600.98, 211.489, 609.112],
          [58.054, 590.321, 153.781, 598.454],
        ],
      },
      sortIndex: "00000|000435|00180",
    },
  ],
};

function moved(annotationKey: string, step = 0): GeometryEdit {
  const edit = MOVES[annotationKey]?.[step];
  if (!edit) throw new Error(`No move ${step} for ${annotationKey}`);
  return edit;
}

type SentTag = Required<WireTag>;

function zoteroTagging(
  annotationKey: string,
  tags: NonNullable<WireAnnotation["tags"]>,
) {
  let stored: WireAnnotation = { ...afterWrite(annotationKey, {}), tags };
  const patches: { version: number; tags: SentTag[] }[] = [];
  let hold: Promise<void> | null = null;
  return {
    answers: {
      children: () =>
        annotationPage(
          ROUGIER_ANNOTATIONS.map((entry) =>
            entry.key === annotationKey ? stored : entry,
          ),
        ),
      item: () => annotationItem(stored),
      write: async (request) => {
        const body = JSON.parse(request.body ?? "{}") as {
          version: number;
          tags?: SentTag[];
          annotationComment?: string;
          annotationText?: string;
        };
        const { tags: sent, annotationComment, annotationText } = body;
        if (sent) patches.push({ version: body.version, tags: sent });
        if (hold) await hold;
        if (body.version !== stored.version) return staleVersionPatch();
        stored = {
          ...stored,
          ...(sent && {
            tags: sent.map(({ tag, type }) =>
              type === 0 ? tag : { tag, type },
            ),
          }),
          ...(annotationComment !== undefined && {
            comment: annotationComment,
          }),
          ...(annotationText !== undefined && { text: annotationText }),
          version: stored.version + 1,
        };
        return writeAccepted();
      },
    } satisfies ZoteroAnswers,
    patches,
    get tags() {
      return stored.tags;
    },
    get comment() {
      return stored.comment;
    },
    get text() {
      return stored.text;
    },
    changeInZotero(patch: Partial<WireAnnotation>): void {
      stored = { ...stored, ...patch, version: stored.version + 1 };
    },
    holdWrites(): () => void {
      const { promise, resolve } = Promise.withResolvers<void>();
      hold = promise;
      return () => {
        hold = null;
        resolve();
      };
    },
  };
}

const TAGGED = ["review", { tag: "nlp", type: 1 }, "todo"] as const;

export {
  READING_ORDER,
  DATABASE_SOURCE,
  DRAFT,
  MADE,
  colorOf,
  annotationRows,
  zoteroHolding,
  moved,
  zoteroTagging,
  TAGGED,
};
