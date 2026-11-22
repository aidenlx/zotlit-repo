import { Effect, Predicate, Schema, SchemaGetter } from "effect";
import type { SchemaIssue } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import type { RpcClient, RpcClientError } from "effect/rpc";
import { Transferable } from "effect/workers";

import type {
  Annotation,
  AnnotationSources,
  AnnotViewAttachment,
  Attachment,
  AttachmentWithParentKey,
  ChildNote,
  Creator,
  getItemDisplayRefByID,
  Item,
  ItemBaseFields,
  ItemFacets,
  ItemTag,
  Library,
  Note,
  NoteSource,
  TemplateCollection,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";
import type { AnnotationPositionRaw } from "@zotlit/db";
import type {
  SearchHit as ItemIndexHit,
  SegmenterBinary as ItemIndexSegmenterBinary,
} from "@zotlit/item-lookup";
import type {
  PackBinaryRefusal,
  PackBinaryStatus,
} from "@zotlit/resource-pack/status.ts";
import type { ItemFields } from "@zotlit/zotero-types";

import type {
  CitationLookupWireAnswer,
  CitekeyResolution,
  SnapshotItem,
} from "./citation-lookup.ts";
import { DbUnavailable } from "./db-unavailable.ts";
import { Instant } from "./instant-codec.ts";
import type { ItemQueryAnswer, ItemQueryJob } from "./item-query.ts";
import { libraryScopeWire } from "./library-scope.ts";
import type { LibraryScope } from "./library-scope.ts";
import { DecodedQuery, DecodedValues } from "./query-codec.ts";
import type { ItemSnapshot } from "./snapshot/types.ts";

type Expect<T extends true> = T;
type Equals<A, B> = [A, B] extends [B, A] ? true : false;

function rawInt<T extends number>() {
  return Schema.declare((u: unknown): u is T => Predicate.isNumber(u));
}

function jsonObject<T extends object>() {
  return Schema.declare((u: unknown): u is T => Predicate.isObject(u));
}

const QueryJobSchema = jsonObject<ItemQueryJob>().pipe(
  Schema.decodeTo(jsonObject<ItemQueryJob>(), {
    decode: SchemaGetter.transformEffect((job: ItemQueryJob) =>
      codeRequest(job, Schema.decodeUnknownEffect),
    ),
    encode: SchemaGetter.transformEffect((job: ItemQueryJob) =>
      codeRequest(job, Schema.encodeUnknownEffect),
    ),
  }),
);

function codeRequest(
  job: ItemQueryJob,
  code: typeof Schema.decodeUnknownEffect,
): Effect.Effect<ItemQueryJob, SchemaIssue.Issue> {
  const request =
    "query" in job && job.query
      ? code(DecodedQuery)(job.query).pipe(
          Effect.map((query): ItemQueryJob => ({ ...job, query })),
        )
      : "values" in job && job.values
        ? code(DecodedValues)(job.values).pipe(
            Effect.map((values): ItemQueryJob => ({ ...job, values })),
          )
        : Effect.succeed(job);
  return Effect.mapError(request, (error) => error.issue);
}

export { DbUnavailable };

export class SnapshotExpired extends Schema.TaggedError<
  SnapshotExpired,
  { readonly brand: unique symbol }
>()("SnapshotExpired", { snapshot: Schema.String }) {}

export const ReadError = Schema.Union([DbUnavailable, SnapshotExpired]);

export const LibrarySchema = Schema.Struct({
  libraryID: Schema.Int,
  type: Schema.Literals(["user", "group"]),
  version: Schema.Int,
  clientVersion: Schema.NullOr(Schema.Int),
  groupID: Schema.NullOr(Schema.Int),
  name: Schema.NullOr(Schema.String),
});
type _Library = Expect<Equals<typeof LibrarySchema.Type, Library>>;

const CreatorSchema = Schema.Struct({
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  creatorType: Schema.String,
  fieldMode: rawInt<Creator["fieldMode"]>(),
});
type _Creator = Expect<Equals<typeof CreatorSchema.Type, Creator>>;

export const ItemSchema = Schema.Struct({
  itemID: Schema.Int,
  libraryID: Schema.Int,
  key: Schema.String,
  indexedKey: Schema.String,
  dateAdded: Instant,
  dateModified: Instant,
  creators: Schema.mutable(Schema.Array(CreatorSchema)),
  primaryCreatorType: Schema.NullOr(Schema.String),
  customFields: Schema.ReadonlyMap(Schema.String, Schema.NullOr(Schema.String)),
  fields: jsonObject<ItemFields>(),
  baseFields: jsonObject<ItemBaseFields>(),
  venue: Schema.NullOr(Schema.String),
  groupID: Schema.NullOr(Schema.Int),
});
type _Item = Expect<Equals<typeof ItemSchema.Type, Item>>;

export const AttachmentSchema = Schema.Struct({
  itemID: Schema.Int,
  libraryID: Schema.Int,
  groupID: Schema.NullOr(Schema.Int),
  key: Schema.String,
  indexedKey: Schema.String,
  parentItemID: Schema.Int,
  path: Schema.NullOr(Schema.String),
  contentType: Schema.NullOr(Schema.String),
  linkMode: Schema.NullOr(rawInt<NonNullable<Attachment["linkMode"]>>()),
  dateAdded: Instant,
  dateModified: Instant,
});
type _Attachment = Expect<Equals<typeof AttachmentSchema.Type, Attachment>>;

export const AttachmentWithParentKeySchema = Schema.Struct({
  ...AttachmentSchema.fields,
  parentIndexedKey: Schema.NullOr(Schema.String),
});
type _AttachmentWithParentKey = Expect<
  Equals<typeof AttachmentWithParentKeySchema.Type, AttachmentWithParentKey>
>;

type TagType = ItemTag["type"];

export const AnnotationSchema = Schema.Struct({
  groupID: Schema.NullOr(Schema.Int),
  itemID: Schema.Int,
  key: Schema.String,
  indexedKey: Schema.String,
  libraryID: Schema.Int,
  dateAdded: Instant,
  dateModified: Instant,
  version: Schema.Int,
  type: rawInt<Annotation["type"]>(),
  text: Schema.NullOr(Schema.String),
  comment: Schema.NullOr(Schema.String),
  color: Schema.NullOr(Schema.String),
  pageLabel: Schema.NullOr(Schema.String),
  tags: Schema.mutable(Schema.Array(Schema.String)),
  tagDetails: Schema.optionalKey(
    Schema.mutable(
      Schema.Array(
        Schema.Struct({ name: Schema.String, type: rawInt<TagType>() }),
      ),
    ),
  ),
  sortIndex: Schema.String,
  position: jsonObject<AnnotationPositionRaw>(),
  authorName: Schema.NullOr(Schema.String),
  isExternal: Schema.Boolean,
  createdByUserID: Schema.NullOr(Schema.Int),
  parentItemID: Schema.Int,
  parentKey: Schema.String,
});
type _Annotation = Expect<Equals<typeof AnnotationSchema.Type, Annotation>>;

export const ChildNoteSchema = Schema.Struct({
  groupID: Schema.NullOr(Schema.Int),
  itemID: Schema.Int,
  libraryID: Schema.Int,
  key: Schema.String,
  indexedKey: Schema.String,
  parentItemID: Schema.NullOr(Schema.Int),
  title: Schema.NullOr(Schema.String),
  dateModified: Instant,
});
type _ChildNote = Expect<Equals<typeof ChildNoteSchema.Type, ChildNote>>;

export const NoteSchema = Schema.Struct({
  ...ChildNoteSchema.fields,
  note: Schema.NullOr(Schema.String),
  dateAdded: Instant,
});
type _Note = Expect<Equals<typeof NoteSchema.Type, Note>>;

const ItemTagSchema = Schema.Struct({
  itemID: Schema.Int,
  tag: Schema.Struct({ tagID: Schema.Int, name: Schema.String }),
  type: rawInt<TagType>(),
});
type _ItemTag = Expect<Equals<typeof ItemTagSchema.Type, ItemTag>>;

const TemplateCollectionSchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  path: Schema.Array(Schema.String),
});
type _TemplateCollection = Expect<
  Equals<typeof TemplateCollectionSchema.Type, TemplateCollection>
>;

const TagsByItemID = Schema.ReadonlyMap(
  Schema.Int,
  Schema.Array(ItemTagSchema),
);

export const NoteSourceSchema = Schema.Struct({
  item: ItemSchema,
  username: Schema.NullOr(Schema.String),
  attachments: Schema.Array(AttachmentSchema),
  annotationsByAttachment: Schema.ReadonlyMap(
    Schema.Int,
    Schema.Array(AnnotationSchema),
  ),
  tagsByItemID: TagsByItemID,
  collectionsByItemID: Schema.ReadonlyMap(
    Schema.Int,
    Schema.Array(TemplateCollectionSchema),
  ),
  relatedItems: Schema.Array(ItemSchema),
  childNotes: Schema.Array(ChildNoteSchema),
});
type _NoteSource = Expect<Equals<typeof NoteSourceSchema.Type, NoteSource>>;

const ItemFacetsSchema = Schema.Struct({
  tags: Schema.Array(ItemTagSchema),
  collections: Schema.Array(TemplateCollectionSchema),
});
type _ItemFacets = Expect<Equals<typeof ItemFacetsSchema.Type, ItemFacets>>;

export const AnnotationSourcesSchema = Schema.Struct({
  annotations: Schema.Array(AnnotationSchema),
  attachments: Schema.Array(AttachmentSchema),
  parentItems: Schema.Array(ItemSchema),
  tagsByItemID: TagsByItemID,
  username: Schema.NullOr(Schema.String),
});
type _AnnotationSources = Expect<
  Equals<typeof AnnotationSourcesSchema.Type, AnnotationSources>
>;

export const ItemDisplayRefSchema = Schema.Struct({
  itemID: Schema.Int,
  libraryID: Schema.Int,
  key: Schema.String,
  groupID: Schema.NullOr(Schema.Int),
  indexedKey: Schema.String,
  title: Schema.NullOr(Schema.String),
});
type _ItemDisplayRef = Expect<
  Equals<
    typeof ItemDisplayRefSchema.Type,
    NonNullable<ReturnType<typeof getItemDisplayRefByID>>
  >
>;

export const WorkLabelSourceSchema = Schema.Struct({
  libraryID: Schema.Int,
  creators: Schema.mutable(Schema.Array(CreatorSchema)),
  primaryCreatorType: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  shortTitle: Schema.NullOr(Schema.String),
  date: Schema.NullOr(Schema.String),
});
export type WorkLabelSource = typeof WorkLabelSourceSchema.Type;

export const AnnotViewAttachmentSchema = Schema.Struct({
  itemID: Schema.Int,
  indexedKey: Schema.String,
  path: Schema.NullOr(Schema.String),
  annotCount: Schema.Int,
});
type _AnnotViewAttachment = Expect<
  Equals<typeof AnnotViewAttachmentSchema.Type, AnnotViewAttachment>
>;

export const ReaderTargetKeysSchema = Schema.Struct({
  attachmentKey: Schema.String,
  itemKey: Schema.NullOr(Schema.String),
  selected: Schema.Array(Schema.String),
});

export const SearchHitSchema = Schema.Struct({
  item: ItemSchema,
  matches: Schema.mutable(
    Schema.Array(Schema.mutable(Schema.Tuple([Schema.Int, Schema.Int]))),
  ),
});
export type SearchHit = typeof SearchHitSchema.Type;
type _SearchHit = Expect<Equals<SearchHit, ItemIndexHit>>;

export const DatabaseIdentitySchema = Schema.Struct({
  userID: Schema.NullOr(Schema.Int),
  localUserKey: Schema.NullOr(Schema.String),
  serverID: Schema.NullOr(Schema.String),
});
type _DatabaseIdentity = Expect<
  Equals<typeof DatabaseIdentitySchema.Type, ZoteroDatabaseIdentity>
>;

export const ItemSnapshotRequestSchema = Schema.Struct({
  selection: Schema.Struct({
    library: Schema.Union([
      Schema.Struct({ type: Schema.Literal("personal") }),
      Schema.Struct({ type: Schema.Literal("group"), groupID: Schema.Int }),
    ]),
    key: Schema.String,
  }),
  provenance: Schema.Union([
    Schema.Struct({
      kind: Schema.Literal("sample"),
      id: Schema.String,
      source: Schema.optionalKey(Schema.String),
    }),
    Schema.Struct({
      kind: Schema.Literal("connected"),
      installationId: Schema.String,
      vault: Schema.String,
    }),
  ]),
  vaultTargets: Schema.optionalKey(
    Schema.Struct({
      notes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
      attachments: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.String),
      ),
      annotationImages: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.String),
      ),
    }),
  ),
});

export const SegmenterBinarySchema = Schema.Struct({
  url: Schema.String,
  entry: Schema.String,
  version: Schema.String,
});
export type SegmenterBinary = typeof SegmenterBinarySchema.Type;

export const PackBinaryRefusalSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("pack-absent") }),
  Schema.Struct({ kind: Schema.Literal("pack-outdated") }),
  Schema.Struct({ kind: Schema.Literal("plugin-outdated") }),
  Schema.Struct({ kind: Schema.Literal("pack-damaged") }),
  Schema.Struct({ kind: Schema.Literal("failed"), detail: Schema.String }),
]);
type _PackBinaryRefusal = Expect<
  Equals<typeof PackBinaryRefusalSchema.Type, PackBinaryRefusal>
>;

export const PackBinaryStatusSchema = Schema.Union([
  ...PackBinaryRefusalSchema.members,
  Schema.Struct({ kind: Schema.Literal("ready"), version: Schema.String }),
]);
type _PackBinaryStatus = Expect<
  Equals<typeof PackBinaryStatusSchema.Type, PackBinaryStatus>
>;
type _SegmenterBinary = Expect<
  Equals<SegmenterBinary, ItemIndexSegmenterBinary>
>;

export const ReadsConfigSchema = Schema.Struct({
  databasePath: Schema.String,
  readMode: Schema.Literals(["auto", "reflink", "copy", "immutable"]),
  autoRefresh: Schema.Boolean,
  locale: Schema.NullOr(Schema.String),
  chineseSegmenter: Schema.NullOr(SegmenterBinarySchema),
  logLevel: Schema.NullOr(
    Schema.Literals(["trace", "debug", "info", "warning", "error", "fatal"]),
  ),
});
export type ReadsConfig = typeof ReadsConfigSchema.Type;

export type ConfiguredReadMode = ReadsConfig["readMode"];

export const WorkerInitSchema = Schema.Struct({
  ...ReadsConfigSchema.fields,
  snapshotOwner: Schema.String,
  deferOpen: Schema.Boolean,
  logs: Transferable.MessagePort,
});

const readMode = {
  readMode: Schema.optionalKey(
    Schema.Literals(["reflink", "copy", "immutable"]),
  ),
};
export type EffectiveReadMode = NonNullable<(typeof readMode.readMode)["Type"]>;

export const ChangeEventSchema = Schema.Union([
  Schema.TaggedStruct("state", {
    state: Schema.Literals(["loading", "ready", "degraded"]),
    error: Schema.NullOr(DbUnavailable),
    ...readMode,
    moved: Schema.optional(Schema.Boolean),
  }),
  Schema.TaggedStruct("changed", readMode),
  Schema.TaggedStruct("degraded", { error: DbUnavailable }),
  Schema.TaggedStruct("refresh-failed", {
    error: DbUnavailable,
    moved: Schema.Boolean,
  }),
  Schema.TaggedStruct("refreshing", { active: Schema.Boolean }),
  Schema.TaggedStruct("db-file-missing", {}),
]);
export type ChangeEvent = typeof ChangeEventSchema.Type;

export const SnapshotId = Schema.String.pipe(Schema.brand("SnapshotId"));
export type SnapshotId = typeof SnapshotId.Type;

const snapshot = { snapshot: Schema.optionalKey(SnapshotId) };

const CitationItemSchema = Schema.Struct({
  itemID: Schema.Int,
  libraryID: Schema.Int,
  key: Schema.String,
  indexedKey: Schema.String,
});
type _CitationItem = Expect<
  Equals<typeof CitationItemSchema.Type, SnapshotItem>
>;
const CitationResolutionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("missing") }),
  Schema.Struct({ kind: Schema.Literal("unique"), item: CitationItemSchema }),
  Schema.Struct({
    kind: Schema.Literal("ambiguous"),
    candidates: Schema.Array(CitationItemSchema),
  }),
]);
type _CitationResolution = Expect<
  Equals<typeof CitationResolutionSchema.Type, CitekeyResolution>
>;
const CitationScopeSchema = Schema.NullOr(libraryScopeWire);
type _CitationScope = Expect<
  Equals<typeof CitationScopeSchema.Type, LibraryScope | null>
>;
const CitationLookupAnswerSchema = Schema.Struct({
  revision: Schema.String,
  citekeys: Schema.ReadonlyMap(Schema.String, CitationResolutionSchema),
  indexedKeys: Schema.ReadonlyMap(Schema.String, Schema.NullOr(Schema.String)),
  annotationKeys: Schema.ReadonlyMap(
    Schema.String,
    Schema.NullOr(
      Schema.Struct({
        indexedKey: Schema.String,
        citekey: Schema.NullOr(Schema.String),
      }),
    ),
  ),
});
type _CitationLookupAnswer = Expect<
  Equals<typeof CitationLookupAnswerSchema.Type, CitationLookupWireAnswer>
>;

export class ZoteroReads extends RpcGroup.make(
  Rpc.make("CancelItemQuery", {
    payload: { id: Schema.String, ...snapshot },
    success: Schema.Void,
  }),
  Rpc.make("ItemQuery", {
    payload: { job: QueryJobSchema, ...snapshot },
    success: jsonObject<ItemQueryAnswer>(),
    error: ReadError,
  }),
  Rpc.make("CitationLookup", {
    payload: {
      scope: CitationScopeSchema,
      citekeys: Schema.optionalKey(Schema.Array(Schema.String)),
      indexedKeys: Schema.optionalKey(Schema.Array(Schema.String)),
      annotationKeys: Schema.optionalKey(Schema.Array(Schema.String)),
    },
    success: CitationLookupAnswerSchema,
    error: DbUnavailable,
  }),
  Rpc.make("Libraries", {
    payload: snapshot,
    success: Schema.mutable(Schema.Array(LibrarySchema)),
    error: ReadError,
  }),
  Rpc.make("ConnectionReadout", {
    payload: snapshot,
    success: Schema.Struct({ itemCount: Schema.Int }),
    error: ReadError,
  }),
  Rpc.make("ItemsByIndexedKeys", {
    payload: { indexedKeys: Schema.Array(Schema.String), ...snapshot },
    success: Schema.ReadonlyMap(Schema.String, ItemSchema),
    error: ReadError,
  }),
  Rpc.make("ItemFamily", {
    payload: { itemID: Schema.Int, ...snapshot },
    success: Schema.Struct({
      relatedItems: Schema.Array(ItemSchema),
      childNotes: Schema.Array(ChildNoteSchema),
    }),
    error: ReadError,
  }),
  Rpc.make("NoteSource", {
    payload: {
      itemID: Schema.Int,
      username: Schema.optionalKey(Schema.NullOr(Schema.String)),
      ...snapshot,
    },
    success: Schema.NullOr(NoteSourceSchema),
    error: ReadError,
  }),
  Rpc.make("ItemFacets", {
    payload: {
      items: Schema.Array(
        Schema.Struct({ itemID: Schema.Int, libraryID: Schema.Int }),
      ),
      ...snapshot,
    },
    success: Schema.Array(
      Schema.Struct({ itemID: Schema.Int, facets: ItemFacetsSchema }),
    ),
    error: ReadError,
    stream: true,
  }),
  Rpc.make("AnnotationSources", {
    payload: {
      libraryID: Schema.Int,
      keys: Schema.Array(Schema.String),
      username: Schema.optionalKey(Schema.NullOr(Schema.String)),
      ...snapshot,
    },
    success: AnnotationSourcesSchema,
    error: ReadError,
  }),
  Rpc.make("AnnotationsOfAttachment", {
    payload: { attachmentKey: Schema.String, ...snapshot },
    success: Schema.Struct({
      attachment: Schema.NullOr(AttachmentSchema),
      annotations: Schema.Array(AnnotationSchema),
      accountUserID: Schema.NullOr(Schema.Int),
    }),
    error: ReadError,
  }),
  Rpc.make("AnnotationsOfAttachments", {
    payload: { attachmentKeys: Schema.Array(Schema.String), ...snapshot },
    success: Schema.Array(
      Schema.Struct({
        attachmentKey: Schema.String,
        attachment: Schema.NullOr(AttachmentSchema),
        annotations: Schema.Array(AnnotationSchema),
        accountUserID: Schema.NullOr(Schema.Int),
      }),
    ),
    error: ReadError,
  }),
  Rpc.make("AttachmentsOf", {
    payload: { itemIDs: Schema.Array(Schema.Int), ...snapshot },
    success: Schema.Array(AttachmentSchema),
    error: ReadError,
  }),
  Rpc.make("DisplayRefs", {
    payload: {
      itemIDs: Schema.Array(Schema.Int),
      ...snapshot,
    },
    success: Schema.Array(
      Schema.Struct({
        itemID: Schema.Int,
        ref: Schema.NullOr(ItemDisplayRefSchema),
      }),
    ),
    error: ReadError,
    stream: true,
  }),
  Rpc.make("NoteBodies", {
    payload: {
      libraryID: Schema.Int,
      keys: Schema.Array(Schema.String),
      ...snapshot,
    },
    success: Schema.Array(NoteSchema),
    error: ReadError,
  }),
  Rpc.make("WorkLabels", {
    payload: { indexedKeys: Schema.Array(Schema.String), ...snapshot },
    success: Schema.ReadonlyMap(Schema.String, WorkLabelSourceSchema),
    error: ReadError,
  }),
  Rpc.make("AttachmentPathIndex", {
    payload: snapshot,
    success: Schema.Array(AttachmentWithParentKeySchema),
    error: ReadError,
    stream: true,
  }),
  Rpc.make("Changes", {
    success: ChangeEventSchema,
    stream: true,
  }),
  Rpc.make("Snapshot", {
    success: SnapshotId,
    error: DbUnavailable,
    stream: true,
  }),
  Rpc.make("Refresh", { error: DbUnavailable }),
  Rpc.make("NotifyExternalChange", {}),
  Rpc.make("Configure", { payload: ReadsConfigSchema }),
  Rpc.make("CheckChineseSegmenter", {
    payload: { binary: Schema.NullOr(SegmenterBinarySchema) },
    success: PackBinaryStatusSchema,
  }),
  Rpc.make("Ping", {}),
  Rpc.make("AttachmentsByKeys", {
    payload: {
      libraryID: Schema.Int,
      keys: Schema.Array(Schema.String),
      ...snapshot,
    },
    success: Schema.Array(AttachmentSchema),
    error: ReadError,
  }),
  Rpc.make("SearchItems", {
    payload: {
      libraryIDs: Schema.Array(Schema.Int),
      query: Schema.String,
      limit: Schema.Int,
      uses: Schema.optionalKey(Schema.Record(Schema.String, Schema.Int)),
      cited: Schema.optionalKey(Schema.Array(Schema.String)),
    },
    success: Schema.Array(SearchHitSchema),
    error: DbUnavailable,
  }),
  Rpc.make("DatabaseIdentity", {
    payload: snapshot,
    success: DatabaseIdentitySchema,
    error: ReadError,
  }),
  Rpc.make("ItemSnapshot", {
    payload: { ...ItemSnapshotRequestSchema.fields, ...snapshot },
    success: jsonObject<ItemSnapshot>(),
    error: ReadError,
  }),
  Rpc.make("ItemType", {
    payload: { indexedKey: Schema.String, ...snapshot },
    success: Schema.NullOr(
      Schema.Struct({
        libraryID: Schema.Int,
        key: Schema.String,
        itemType: Schema.String,
      }),
    ),
    error: ReadError,
  }),
  Rpc.make("AnnotViewAttachments", {
    payload: {
      libraryID: Schema.Int,
      key: Schema.String,
      standalone: Schema.Boolean,
      ...snapshot,
    },
    success: Schema.mutable(Schema.Array(AnnotViewAttachmentSchema)),
    error: ReadError,
  }),
  Rpc.make("ReaderTargetKeys", {
    payload: {
      attachmentID: Schema.Int,
      selected: Schema.Array(Schema.Int),
      ...snapshot,
    },
    success: Schema.NullOr(ReaderTargetKeysSchema),
    error: ReadError,
  }),
  Rpc.make("AttachmentsAt", {
    payload: { itemID: Schema.Int, ...snapshot },
    success: Schema.Array(AttachmentSchema),
    error: ReadError,
  }),
  Rpc.make("AttachmentSources", {
    payload: {
      attachmentKeys: Schema.Array(Schema.String),
      username: Schema.optionalKey(Schema.NullOr(Schema.String)),
      ...snapshot,
    },
    success: AnnotationSourcesSchema,
    error: ReadError,
  }),
  Rpc.make("ScopeItemIDs", {
    payload: {
      kind: Schema.Literals(["literature-items", "notes"]),
      libraryID: Schema.Int,
      collectionKey: Schema.optionalKey(Schema.String),
      ...snapshot,
    },
    success: Schema.NullOr(Schema.Array(Schema.Int)),
    error: ReadError,
  }),
  Rpc.make("NoteRefs", {
    payload: {
      itemIDs: Schema.Array(Schema.Int),
      ...snapshot,
    },
    success: Schema.Array(
      Schema.Struct({
        itemID: Schema.Int,
        note: Schema.NullOr(ChildNoteSchema),
        trashed: Schema.Boolean,
      }),
    ),
    error: ReadError,
    stream: true,
  }),
  Rpc.make("ChildNoteRefs", {
    payload: {
      itemIDs: Schema.Array(Schema.Int),
      ...snapshot,
    },
    success: Schema.Array(
      Schema.Struct({
        itemID: Schema.Int,
        ref: Schema.NullOr(ItemDisplayRefSchema),
        notes: Schema.Array(ChildNoteSchema),
      }),
    ),
    error: ReadError,
    stream: true,
  }),
  Rpc.make("TagNames", {
    payload: { libraryID: Schema.optionalKey(Schema.Int), ...snapshot },
    success: Schema.Array(Schema.String),
    error: ReadError,
  }),
  Rpc.make("CollectionPaths", {
    payload: { libraryIDs: Schema.Array(Schema.Int), ...snapshot },
    success: Schema.Array(Schema.Array(Schema.String)),
    error: ReadError,
  }),
) {}

export type ZoteroReadsClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof ZoteroReads>,
  RpcClientError.RpcClientError
>;
