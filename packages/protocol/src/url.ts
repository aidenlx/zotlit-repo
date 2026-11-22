import * as v from "valibot";

import {
  formatIndexedKey,
  isItemKey,
  parseIndexedKey,
} from "@zotlit/zotero-types/keys";

import type { ProtocolAction } from "./actions.ts";
import {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  openAttachmentProtocolActionId,
  protocolActionId,
  showInLibraryProtocolActionId,
  updateAllProtocolActionId,
} from "./actions.ts";

export {
  batchProtocolActionId,
  exploreProtocolActionId,
  importAllNotesProtocolActionId,
  importManyProtocolActionId,
  importProtocolActionId,
  openAttachmentProtocolActionId,
  type ProtocolAction,
  protocolActionId,
  protocolActions,
  showInLibraryProtocolActionId,
  updateAllProtocolActionId,
} from "./actions.ts";

const itemID = v.pipe(v.string(), v.regex(/^\d+$/u), v.transform(Number));

const sourceIdValue = v.pipe(v.string(), v.regex(/^[0-9a-f]{8}$/u));

export type UpdateScope = "full" | "metadata";

const updateScopeValue = v.optional(
  v.picklist(["full", "metadata"] satisfies UpdateScope[]),
  "full",
);

const literatureNoteProfileValue = v.optional(
  v.pipe(v.string(), v.regex(/^[A-Za-z0-9]{12}$/u)),
);

export type PaneType = "tab" | "split" | "window";

const paneTypeValue = v.optional(
  v.picklist(["tab", "split", "window"] satisfies PaneType[]),
);

export const protocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    "source-id": sourceIdValue,
    scope: updateScopeValue,
    profile: literatureNoteProfileValue,
    paneType: paneTypeValue,
  }),
  v.transform(({ item, "source-id": sourceId, scope, profile, paneType }) => ({
    item,
    sourceId,
    scope,
    ...(profile === undefined ? {} : { profileId: profile }),
    ...(paneType === undefined ? {} : { paneType }),
  })),
);

export type ProtocolQuery = v.InferOutput<typeof protocolQuerySchema>;

export function protocolSourceMatches(
  query: { sourceId: string },
  expected: string | null,
): boolean {
  return expected !== null && query.sourceId === expected;
}

export function buildProtocolUrl(
  action: ProtocolAction,
  item: number,
  options: {
    sourceId: string;
    scope?: UpdateScope;
    profileId?: string;
    paneType?: PaneType;
  },
): string {
  const params = protocolUrlParams({ item: String(item) }, options.sourceId);
  appendScope(params, options.scope);
  appendProfile(params, options.profileId);
  appendPaneType(params, options.paneType);
  return `obsidian://${protocolActionId(action)}?${params}`;
}

function protocolUrlParams(
  params: Record<string, string>,
  sourceId: string,
): URLSearchParams {
  return new URLSearchParams({ ...params, "source-id": sourceId });
}

function appendScope(
  params: URLSearchParams,
  scope: UpdateScope | undefined,
): void {
  if (scope && scope !== "full") params.set("scope", scope);
}

function appendProfile(
  params: URLSearchParams,
  profileId: string | undefined,
): void {
  if (profileId) params.set("profile", profileId);
}

function appendPaneType(
  params: URLSearchParams,
  paneType: PaneType | undefined,
): void {
  if (paneType) params.set("paneType", paneType);
}

const batchItems = v.pipe(
  v.string(),
  v.transform((raw) => raw.split(",").filter(Boolean)),
  v.array(itemID),
  v.transform((ids) => [...new Set(ids)]),
  v.minLength(1),
);

export const protocolBatchQuerySchema = v.pipe(
  v.object({
    items: batchItems,
    "source-id": sourceIdValue,
    scope: updateScopeValue,
    profile: literatureNoteProfileValue,
  }),
  v.transform(({ items, "source-id": sourceId, scope, profile }) => ({
    items,
    sourceId,
    scope,
    ...(profile === undefined ? {} : { profileId: profile }),
  })),
);

export type ProtocolBatchQuery = v.InferOutput<typeof protocolBatchQuerySchema>;

export function parseProtocolBatchQuery(
  data: Record<string, unknown>,
): ProtocolBatchQuery {
  return v.parse(protocolBatchQuerySchema, data);
}

const dedupedItemIDs = v.pipe(
  v.array(v.pipe(v.number(), v.integer())),
  v.transform((ids) => [...new Set(ids)]),
  v.minLength(1),
);

export const batchUpdateRequestSchema = v.pipe(
  v.object({
    items: dedupedItemIDs,
    scope: updateScopeValue,
    profile: literatureNoteProfileValue,
  }),
  v.transform(({ items, scope, profile }) => ({
    items,
    scope,
    ...(profile === undefined ? {} : { profileId: profile }),
  })),
);

export type BatchUpdateRequest = v.InferInput<typeof batchUpdateRequestSchema>;

export type ImportMode = "note" | "child";

const importModeValue = v.picklist(["note", "child"] satisfies ImportMode[]);

export const importProtocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    mode: importModeValue,
    "source-id": sourceIdValue,
  }),
  v.transform(({ item, mode, "source-id": sourceId }) => ({
    item,
    mode,
    sourceId,
  })),
);

export type ImportProtocolQuery = v.InferOutput<
  typeof importProtocolQuerySchema
>;

export const importManyProtocolQuerySchema = v.pipe(
  v.object({
    items: batchItems,
    mode: importModeValue,
    "source-id": sourceIdValue,
  }),
  v.transform(({ items, mode, "source-id": sourceId }) => ({
    items,
    mode,
    sourceId,
  })),
);

export type ImportManyProtocolQuery = v.InferOutput<
  typeof importManyProtocolQuerySchema
>;

export function parseImportProtocolQuery(
  data: Record<string, unknown>,
): ImportProtocolQuery {
  return v.parse(importProtocolQuerySchema, data);
}

export function parseImportManyProtocolQuery(
  data: Record<string, unknown>,
): ImportManyProtocolQuery {
  return v.parse(importManyProtocolQuerySchema, data);
}

export const importNotesRequestSchema = v.object({
  items: dedupedItemIDs,
  mode: importModeValue,
});

export type ImportNotesRequest = v.InferInput<typeof importNotesRequestSchema>;

export function buildImportProtocolUrl(
  item: number,
  options: { sourceId: string; mode: ImportMode },
): string {
  const params = protocolUrlParams(
    { item: String(item), mode: options.mode },
    options.sourceId,
  );
  return `obsidian://${importProtocolActionId}?${params}`;
}

export function buildImportManyProtocolUrl(
  items: readonly number[],
  options: { sourceId: string; mode: ImportMode },
): string {
  const params = protocolUrlParams(
    { items: items.join(","), mode: options.mode },
    options.sourceId,
  );
  return `obsidian://${importManyProtocolActionId}?${params}`;
}

export function buildBatchProtocolUrl(
  items: readonly number[],
  options: {
    sourceId: string;
    scope?: UpdateScope;
    profileId?: string;
  },
): string {
  const params = protocolUrlParams(
    { items: items.join(",") },
    options.sourceId,
  );
  appendScope(params, options.scope);
  appendProfile(params, options.profileId);
  return `obsidian://${batchProtocolActionId}?${params}`;
}

const annotationKeyValue = v.optional(v.pipe(v.string(), v.check(isItemKey)));

export const exploreProtocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    annotation: annotationKeyValue,
    "source-id": sourceIdValue,
    paneType: paneTypeValue,
  }),
  v.transform(({ item, annotation, "source-id": sourceId, paneType }) => ({
    item,
    annotation,
    sourceId,
    ...(paneType === undefined ? {} : { paneType }),
  })),
);

export type ExploreProtocolQuery = v.InferOutput<
  typeof exploreProtocolQuerySchema
>;

export function parseExploreProtocolQuery(
  data: Record<string, unknown>,
): ExploreProtocolQuery {
  return v.parse(exploreProtocolQuerySchema, data);
}

export const showInLibraryProtocolQuerySchema = v.pipe(
  v.object({
    "item-key": v.pipe(
      v.string(),
      v.check((key) => parseIndexedKey(key) !== null),
    ),
  }),
  v.transform(({ "item-key": indexedKey }) => ({ indexedKey })),
);

export function libraryViewUri(key: string, groupID: number | null): string {
  const params = new URLSearchParams({
    "item-key": formatIndexedKey(key, groupID),
  });
  return `obsidian://${showInLibraryProtocolActionId}?${params}`;
}

type ShowInLibraryProtocolQuery = v.InferOutput<
  typeof showInLibraryProtocolQuerySchema
>;

export function parseShowInLibraryProtocolQuery(
  data: Record<string, unknown>,
): ShowInLibraryProtocolQuery {
  return v.parse(showInLibraryProtocolQuerySchema, data);
}

const collectionKeyValue = v.optional(v.pipe(v.string(), v.check(isItemKey)));

const exactLibraryTargetQuerySchema = v.pipe(
  v.object({
    "source-id": sourceIdValue,
    library: v.optional(v.pipe(v.string(), v.regex(/^\d+$/u))),
    collection: collectionKeyValue,
  }),
  v.transform(({ "source-id": sourceId, library, collection }) => ({
    sourceId,
    groupID: library ? Number(library) : 0,
    collectionKey: collection,
  })),
);

export const updateAllProtocolQuerySchema = exactLibraryTargetQuerySchema;

export const importAllNotesProtocolQuerySchema = exactLibraryTargetQuerySchema;

export type UpdateAllProtocolQuery = v.InferOutput<
  typeof updateAllProtocolQuerySchema
>;

export type ImportAllNotesProtocolQuery = v.InferOutput<
  typeof importAllNotesProtocolQuerySchema
>;

export function parseUpdateAllProtocolQuery(
  data: Record<string, unknown>,
): UpdateAllProtocolQuery {
  return v.parse(updateAllProtocolQuerySchema, data);
}

export function parseImportAllNotesProtocolQuery(
  data: Record<string, unknown>,
): ImportAllNotesProtocolQuery {
  return v.parse(importAllNotesProtocolQuerySchema, data);
}

export function buildUpdateAllProtocolUrl(
  sourceId: string,
  groupID?: number,
  collectionKey?: string,
): string {
  return buildExactLibraryTargetUrl(updateAllProtocolActionId, sourceId, {
    groupID,
    collectionKey,
  });
}

export function buildImportAllNotesProtocolUrl(
  sourceId: string,
  groupID?: number,
  collectionKey?: string,
): string {
  return buildExactLibraryTargetUrl(importAllNotesProtocolActionId, sourceId, {
    groupID,
    collectionKey,
  });
}

function buildExactLibraryTargetUrl(
  actionId: string,
  sourceId: string,
  scope: { groupID?: number; collectionKey?: string },
): string {
  const params = protocolUrlParams({}, sourceId);
  if (scope.groupID) params.set("library", String(scope.groupID));
  if (scope.collectionKey) params.set("collection", scope.collectionKey);
  return `obsidian://${actionId}?${params}`;
}

export function buildExploreProtocolUrl(
  item: number,
  options: { sourceId: string; annotation?: string; paneType?: PaneType },
): string {
  const params = protocolUrlParams({ item: String(item) }, options.sourceId);
  if (options.annotation) params.set("annotation", options.annotation);
  appendPaneType(params, options.paneType);
  return `obsidian://${exploreProtocolActionId}?${params}`;
}

export const openAttachmentProtocolQuerySchema = v.pipe(
  v.object({
    item: itemID,
    "source-id": sourceIdValue,
    paneType: paneTypeValue,
  }),
  v.transform(({ item, "source-id": sourceId, paneType }) => ({
    item,
    sourceId,
    ...(paneType === undefined ? {} : { paneType }),
  })),
);

export type OpenAttachmentProtocolQuery = v.InferOutput<
  typeof openAttachmentProtocolQuerySchema
>;

export function parseOpenAttachmentProtocolQuery(
  data: Record<string, unknown>,
): OpenAttachmentProtocolQuery {
  return v.parse(openAttachmentProtocolQuerySchema, data);
}

export function buildOpenAttachmentProtocolUrl(
  item: number,
  options: { sourceId: string; paneType?: PaneType },
): string {
  const params = protocolUrlParams({ item: String(item) }, options.sourceId);
  appendPaneType(params, options.paneType);
  return `obsidian://${openAttachmentProtocolActionId}?${params}`;
}

export function parseProtocolQuery(
  data: Record<string, unknown>,
): ProtocolQuery {
  return v.parse(protocolQuerySchema, data);
}
