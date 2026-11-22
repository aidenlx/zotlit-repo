import type {
  AnnotationLock,
  LockReason,
} from "#core/annotation-repository/lock.ts";
import type { FieldHistoryStep } from "#obsidian/annotation-repository/history.ts";
import type {
  AnnotationTag,
  ConflictedWrite,
  GeometryEdit,
  GeometryInput,
  MutationState,
  TextField,
  WriteFailure,
  WriteRequest,
  WriteTarget,
} from "#obsidian/annotation-repository/write.ts";
import type { Mutation, QueryKey } from "@tanstack/query-core";
import type { Effect } from "effect";

import { tagTypeToName } from "@zotlit/db";
import type {
  Annotation,
  AnnotationPosition,
  Attachment,
  Library,
  ResolvedAnnotationTypeName,
  TemplateTag,
  ZoteroDatabaseIdentity,
} from "@zotlit/db";
import type { LegacyPortError } from "@zotlit/obsidian-kit/legacy-port.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import type {
  LocalApiAnnotation,
  LocalApiSource,
  ZoteroLocalApi,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { storedPosition } from "#obsidian/annotation-repository/reconcile.ts";
import {
  annotationTags,
  commentPatch,
  isTextField,
  TEXT_FIELDS,
  textPatch,
} from "#obsidian/annotation-repository/write.ts";

const ANNOTATIONS = "annotations";

export interface DatabaseAnnotationSource {
  kind: "zotero-db";
  database: {
    userID: number | null;
    localUserKey: string | null;
    serverID: string | null;
  };
  libraryID: number;
  libraryRevision: number | null;
}

export type AnnotationSource = DatabaseAnnotationSource | LocalApiSource;

export interface AnnotationRecord {
  key: string;
  type: ResolvedAnnotationTypeName;
  color: string | null;
  comment: string | null;
  text: string | null;
  parentKey: string;
  pageLabel: string | null;
  sortIndex: string;
  tags: readonly string[];
  tagDetails?: readonly AnnotationTag[];
  position: AnnotationPosition;
  version: number | null;
  lock: AnnotationLock | null;
  templateMetadata?: {
    dateAdded: string | null;
    dateModified: string | null;
    authorName: string | null;
    isExternal: boolean | null;
    tags?: readonly Pick<TemplateTag, "name" | "type">[];
  };
}

export interface AnnotationList {
  source: AnnotationSource;
  annotations: readonly AnnotationRecord[];
}

export type TextFieldDraftState =
  | { kind: "editing" }
  | { kind: "pending" }
  | { kind: "conflict"; fresh: string }
  | { kind: "failed"; failure: WriteFailure };

export interface TextFieldDraft {
  annotationKey: string;
  attachmentKey: string;
  serverID: string;
  baseline: string;
  text: string;
  state: TextFieldDraftState;
  manualSave?: boolean;
}

export type TagDraftState =
  | { kind: "editing" }
  | { kind: "pending" }
  | { kind: "failed"; failure: WriteFailure };

export interface TagDraft {
  annotationKey: string;
  attachmentKey: string;
  serverID: string;
  baseline: readonly string[];
  names: readonly string[];
  state: TagDraftState;
  manualSave?: boolean;
  held?: boolean;
}

interface TextFieldSpec {
  valueOf: (record: AnnotationRecord) => string | null;
  request: (target: WriteTarget, value: string) => WriteRequest;
  propose: (value: string) => ProposedFields;
}

const TEXT_FIELD_SPECS = {
  comment: {
    valueOf: (record) => record.comment,
    request: commentPatch,
    propose: (value) => ({ comment: value === "" ? null : value }),
  },
  text: {
    valueOf: (record) => record.text,
    request: textPatch,
    propose: (value) => ({ text: value === "" ? null : value }),
  },
} satisfies Record<TextField, TextFieldSpec>;

type DraftFields = { [F in TextField]: TextFieldDraft } & { tags: TagDraft };

type DraftField = keyof DraftFields;

const DRAFT_FIELDS: readonly DraftField[] = [...TEXT_FIELDS, "tags"];

type FieldMaps<F extends string, V extends Record<F, unknown>> = {
  [K in F]: Map<string, V[K]>;
};

function fieldMaps<F extends string, V extends Record<F, unknown>>(
  fields: readonly F[],
): FieldMaps<F, V> {
  return Object.fromEntries(
    fields.map((field) => [field, new Map()]),
  ) as FieldMaps<F, V>;
}

export interface AnnotationState {
  mutation: MutationState;
  textDrafts: Readonly<Record<TextField, TextFieldDraft | null>>;
  tagDraft: TagDraft | null;
  hidden: boolean;
  gone: boolean;
}

export type AnnotationRepositoryEvent =
  | {
      _tag: "annotations-changed";
      attachmentKey: string;
    }
  | {
      _tag: "excerpt-pixels-changed";
      record: AnnotationRecord;
      source: AnnotationSource;
    }
  | { _tag: "capability-changed" }
  | {
      _tag: "annotation-changed";
      annotationKey: string;
    }
  | {
      _tag: "history-changed";
      attachmentKey: string;
    }
  | {
      _tag: "write-conflict";
      annotationKey: string;
      attachmentKey: string;
    };

export interface AnnotationRepositoryCoreDeps {
  bridge: Pick<EffectBridge, "runSync" | "runPromiseExit">;
  db: Pick<ZoteroReads["Service"], "snapshot" | "events" | "refresh">;
  queryClient: Pick<
    QueryClients["Service"],
    "client" | "invalidate" | "keysUnder" | "peek" | "read"
  >;
  localApi: Pick<
    ZoteroLocalApi["Service"],
    | "authorizedSend"
    | "changes"
    | "demandSource"
    | "listAnnotations"
    | "probe"
    | "readAnnotation"
    | "state"
    | "writeStateFor"
  >;
  writeToken?: () => string;
  persistedExcerpt?: (
    annotation: AnnotationRecord,
    source: AnnotationSource,
  ) => Effect.Effect<string | null, LegacyPortError>;
  publish: (event: AnnotationRepositoryEvent) => void;
}

interface HeldAnnotation {
  queryKey: QueryKey;
  attachmentKey: string;
  record: AnnotationRecord;
}

type WriteAttempt =
  | { write: Exclude<ConflictedWrite, "geometry">; attempted: string | null }
  | { write: "geometry"; attempted: GeometryEdit; input: GeometryInput }
  | { write: "tags"; session?: true };

type OutcomeWrite = WriteAttempt["write"];

type ConfirmedWrite =
  | {
      kind: "record";
      record: AnnotationRecord;
      write: "color" | "geometry" | "tags" | TextField;
    }
  | { kind: "created"; record: AnnotationRecord }
  | {
      kind: "deleted";
      annotationKey: string;
      lock?: LockReason;
    };

type AnnotationConfirmation =
  | ConfirmedWrite
  | { kind: "observed"; record: AnnotationRecord };

interface GroupWrite {
  attachmentKey: string;
  before: AnnotationRecord;
  applied: ConfirmedWrite;
}

type GroupKind = Extract<FieldHistoryStep["kind"], "existence" | "color">;

interface GroupWrites {
  kind: GroupKind;
  writes: GroupWrite[];
}

type ProposedFields = Partial<
  Pick<
    AnnotationRecord,
    | "color"
    | "comment"
    | "tags"
    | "tagDetails"
    | "position"
    | "sortIndex"
    | "text"
  >
>;

interface PendingProposal {
  annotationKey: string;
  attachmentKey: string;
  serverID: string | null;
  fields: ProposedFields;
}

type AnnotationMutation = Mutation<
  MutationState,
  Error,
  PendingProposal | null
>;

function sourceServerID(source: AnnotationSource): string | null {
  return source.kind === "zotero-local-api"
    ? source.serverID
    : source.database.serverID;
}

function indexedID(serverID: string, key: string): string {
  return `${serverID}\0${key}`;
}

function proposedText(
  field: TextField,
  mutation: AnnotationMutation,
): string | null {
  return mutation.state.variables?.fields[field] ?? null;
}

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? "") === (b ?? "");
}

function freshValueOf(
  record: AnnotationRecord,
  write: ConflictedWrite | "tags",
): string | null {
  if (isTextField(write)) return record[write];
  switch (write) {
    case "color":
      return record.color;
    case "delete":
      return null;
    case "geometry":
      return JSON.stringify([storedPosition(record.position), record.text]);
    case "tags":
      return JSON.stringify(annotationTags(record));
  }
}

function proposedTags(tags: readonly AnnotationTag[]): ProposedFields {
  return { tags: tags.map(({ name }) => name), tagDetails: tags };
}

interface DatabaseAnswer {
  readonly found: {
    readonly attachment: Attachment | null;
    readonly annotations: readonly Annotation[];
    readonly accountUserID: number | null;
  };
  readonly libraries: readonly Library[];
  readonly database: ZoteroDatabaseIdentity;
}

function templateTags(tags: readonly AnnotationTag[] | undefined) {
  return tags?.map(({ name, type }) => ({ name, type: tagTypeToName(type) }));
}

function fromLocalApi({
  key,
  type,
  color,
  comment,
  text,
  parentKey,
  pageLabel,
  sortIndex,
  tags,
  position,
  version,
  dateAdded,
  dateModified,
  authorName,
  isExternal,
  tagDetails,
}: LocalApiAnnotation): AnnotationRecord {
  return {
    key,
    type,
    color,
    comment,
    text,
    parentKey,
    pageLabel,
    sortIndex,
    tags,
    tagDetails,
    position,
    version,
    lock: null,
    templateMetadata: {
      dateAdded,
      dateModified: dateModified ?? null,
      authorName: authorName ?? null,
      isExternal: isExternal ?? null,
      tags: templateTags(tagDetails),
    },
  };
}

export {
  ANNOTATIONS,
  TEXT_FIELD_SPECS,
  DRAFT_FIELDS,
  fieldMaps,
  indexedID,
  sourceServerID,
  proposedText,
  sameText,
  freshValueOf,
  proposedTags,
  templateTags,
  fromLocalApi,
};
export type {
  DraftFields,
  DraftField,
  HeldAnnotation,
  WriteAttempt,
  OutcomeWrite,
  ConfirmedWrite,
  AnnotationConfirmation,
  GroupWrite,
  GroupKind,
  GroupWrites,
  ProposedFields,
  PendingProposal,
  AnnotationMutation,
  DatabaseAnswer,
};
