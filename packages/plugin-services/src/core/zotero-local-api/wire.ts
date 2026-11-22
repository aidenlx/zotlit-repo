import { Duration } from "effect";
import * as v from "valibot";

import { parseAnnotationPosition } from "@zotlit/db";
import type {
  AnnotationPosition,
  AnnotationPositionRaw,
  ResolvedAnnotationTypeName,
} from "@zotlit/db";
import { parseJson } from "@zotlit/plugin-kernel/zotero-http.ts";
import { formatIndexedKey, isItemKey } from "@zotlit/zotero-types/keys";

export const API_VERSION = "3";

export const NO_CACHE_HEADERS: Readonly<Record<string, string>> = {
  "Zotero-API-Version": API_VERSION,
  "Cache-Control": "no-cache",
};

export const CLIENT_NAME = "ZotLit for Obsidian";

export const AUTHORIZE_PATH = "/api/local/authorize";

const SERVER_ID_RE = /^[0-9A-Za-z]{12}$/;

const API_KEY_RE = /^[0-9A-Za-z]{32}$/;

const COLOR_RE = /^#[0-9a-f]{6}$/;

const SORT_INDEX_RE = /^(?:\d{5}\|\d{6}\|\d{5}|\d{5}\|\d{8}|\d{7,8})$/;

const ANNOTATION_TYPES = [
  "highlight",
  "underline",
  "note",
  "image",
  "ink",
  "text",
] as const;

export type LocalApiFailure =
  | { kind: "unreachable" }
  | { kind: "local-api-disabled" }
  | { kind: "unauthorized" }
  | { kind: "denied" }
  | { kind: "not-remembered" }
  | { kind: "not-saved" }
  | { kind: "library-read-only" }
  | { kind: "conflict" }
  | { kind: "write-token-used" }
  | { kind: "not-found" }
  | { kind: "server-changed" }
  | { kind: "cooldown"; retryAfter: Duration.Duration }
  | { kind: "incompatible-zotero" }
  | { kind: "invalid-response"; issue: string }
  | { kind: "unknown-outcome" };

export type LocalApiResult<T> = { value: T } | { failure: LocalApiFailure };

const AUTHORIZE_RATE_LIMIT_WINDOW = Duration.seconds(60);

export interface ZoteroReply {
  status: number;
  headers: Headers;
  text: string;
}

export interface LocalApiAnnotation {
  key: string;
  type: ResolvedAnnotationTypeName;
  color: string | null;
  comment: string | null;
  text: string | null;
  position: AnnotationPosition;
  version: number;
  sortIndex: string;
  parentKey: string;
  pageLabel: string | null;
  dateAdded: string | null;
  dateModified?: string | null;
  authorName?: string | null;
  isExternal?: boolean | null;
  tags: string[];
  tagDetails?: { name: string; type: number }[];
}

export interface WireTag {
  tag: string;
  type?: number;
}

export function classifyReply(
  reply: ZoteroReply,
  serverID: string | null,
): LocalApiFailure | null {
  const answered = reply.headers.get("zotero-server-id");
  if (serverID !== null && answered !== null && answered !== serverID) {
    return { kind: "server-changed" };
  }
  const version = reply.headers.get("zotero-api-version");
  if (version !== null && version !== API_VERSION) {
    return { kind: "incompatible-zotero" };
  }

  const body = reply.text.trim();
  switch (reply.status) {
    case 200:
    case 204:
      return serverID !== null && answered !== serverID
        ? invalid(`server id ${answered ?? "absent"}`)
        : null;
    case 401:
      return { kind: "unauthorized" };
    case 403:
      if (body.includes("Local API is not enabled")) {
        return { kind: "local-api-disabled" };
      }
      if (body.includes("Write access denied")) {
        return { kind: "library-read-only" };
      }
      return isDenial(body) ? { kind: "denied" } : invalid(`403 ${body}`);
    case 404:
      return { kind: "not-found" };
    case 412:
      if (body.includes("Write token already used")) {
        return { kind: "write-token-used" };
      }
      return body.includes("Zotero-Server-ID does not match")
        ? { kind: "server-changed" }
        : { kind: "conflict" };
    case 429:
      return { kind: "cooldown", retryAfter: retryAfter(reply.headers) };
    case 501:
      return { kind: "incompatible-zotero" };
    default:
      return invalid(`${reply.status} ${body}`);
  }
}

export function readAnnotationPage(
  body: string,
  attachmentKey: string,
): LocalApiResult<LocalApiAnnotation[]> {
  const parsed = v.safeParse(itemPageSchema, parseJson(body));
  if (!parsed.success) {
    return { failure: invalid(`annotation list: ${issueOf(parsed.issues)}`) };
  }

  const annotations: LocalApiAnnotation[] = [];
  for (const item of parsed.output) {
    const record = toAnnotation(item, attachmentKey);
    if ("failure" in record) return record;
    annotations.push(record.value);
  }
  return { value: annotations };
}

export function readAnnotationItem(
  body: string,
  attachmentKey: string,
): LocalApiResult<LocalApiAnnotation> {
  const parsed = v.safeParse(itemSchema, parseJson(body));
  if (!parsed.success) {
    return { failure: invalid(`annotation: ${issueOf(parsed.issues)}`) };
  }
  return toAnnotation(parsed.output, attachmentKey);
}

export function readCreateResult(
  body: string,
  expected: { parentKey: string; type: ResolvedAnnotationTypeName },
): LocalApiResult<LocalApiAnnotation> {
  const parsed = v.safeParse(createResultSchema, parseJson(body));
  if (!parsed.success) {
    return { failure: invalid(`create result: ${issueOf(parsed.issues)}`) };
  }
  const { successful, success, failed } = parsed.output;

  const [refused] = Object.values(failed);
  if (refused) {
    return {
      failure: invalid(`create refused: ${refused.code} ${refused.message}`),
    };
  }

  const key = success["0"];
  const created = successful["0"];
  if (key === undefined || created === undefined) {
    return { failure: invalid("create answered no object") };
  }
  if (!isItemKey(key) || created.key !== key || created.data.key !== key) {
    return { failure: invalid(`create answered key ${created.key}`) };
  }
  const annotation = toAnnotation(created, expected.parentKey);
  if ("failure" in annotation) return annotation;
  if (annotation.value.type !== expected.type) {
    return {
      failure: invalid(`create answered ${annotation.value.type}`),
    };
  }
  return annotation;
}

export function libraryPath({ groupID }: { groupID: number | null }): string {
  return groupID === null ? "users/0" : `groups/${groupID}`;
}

export interface AuthorizationGrant {
  key: string;
  remember: boolean;
}

export function readGrant(body: string): LocalApiResult<AuthorizationGrant> {
  const parsed = v.safeParse(grantSchema, parseJson(body));
  if (!parsed.success) {
    return { failure: invalid(`authorization: ${issueOf(parsed.issues)}`) };
  }
  const { key, remember } = parsed.output;
  if (!API_KEY_RE.test(key)) {
    return {
      failure: invalid(`authorization key of ${key.length} characters`),
    };
  }
  return { value: { key, remember } };
}

export function totalResults(headers: Headers): number | null {
  const value = headers.get("total-results");
  if (value === null || value.length === 0) return null;
  const total = Number(value);
  return Number.isSafeInteger(total) && total >= 0 && String(total) === value
    ? total
    : null;
}

export function isServerID(value: string): boolean {
  return SERVER_ID_RE.test(value);
}

export function invalid(issue: string): LocalApiFailure {
  return { kind: "invalid-response", issue };
}

const grantSchema = v.object({
  key: v.string(),
  remember: v.boolean(),
});

const itemSchema = v.object({
  key: v.string(),
  version: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  library: v.object({
    type: v.picklist(["user", "group"]),
    id: v.pipe(v.number(), v.safeInteger()),
  }),
  data: v.object({
    key: v.string(),
    itemType: v.literal("annotation"),
    parentItem: v.string(),
    annotationType: v.picklist(ANNOTATION_TYPES),
    annotationColor: v.optional(v.string()),
    annotationComment: v.optional(v.string()),
    annotationText: v.optional(v.string()),
    annotationSortIndex: v.string(),
    annotationPosition: v.string(),
    annotationPageLabel: v.optional(v.string()),
    dateAdded: v.optional(v.string()),
    dateModified: v.optional(v.string()),
    annotationAuthorName: v.optional(v.string()),
    annotationIsExternal: v.optional(v.boolean()),
    tags: v.optional(
      v.array(v.object({ tag: v.string(), type: v.optional(v.number(), 0) })),
    ),
  }),
});

const itemPageSchema = v.array(itemSchema);

const createResultSchema = v.object({
  successful: v.record(v.string(), itemSchema),
  success: v.record(v.string(), v.string()),
  failed: v.record(
    v.string(),
    v.object({ code: v.number(), message: v.string() }),
  ),
});

type WireItem = v.InferOutput<typeof itemSchema>;

function toAnnotation(
  item: WireItem,
  attachmentKey: string,
): LocalApiResult<LocalApiAnnotation> {
  const { data } = item;
  if (!isItemKey(item.key) || item.key !== data.key) {
    return { failure: invalid(`annotation key ${item.key}`) };
  }

  const groupID = item.library.type === "group" ? item.library.id : null;
  const parent = formatIndexedKey(data.parentItem, groupID);
  if (parent !== attachmentKey) {
    return { failure: invalid(`${item.key} belongs to ${parent}`) };
  }

  const color = emptyToNull(data.annotationColor);
  if (color !== null && !COLOR_RE.test(color)) {
    return { failure: invalid(`${item.key} colour ${color}`) };
  }

  if (!SORT_INDEX_RE.test(data.annotationSortIndex)) {
    return {
      failure: invalid(`${item.key} sort index ${data.annotationSortIndex}`),
    };
  }

  const position = narrowPosition(data.annotationPosition);
  if (position.kind === "unknown") {
    return { failure: invalid(`${item.key} position`) };
  }
  if (!pairsWithType(data.annotationType, position)) {
    return {
      failure: invalid(
        `${item.key} is ${data.annotationType}, ${position.kind}`,
      ),
    };
  }

  return {
    value: {
      key: formatIndexedKey(item.key, groupID),
      type: data.annotationType,
      color,
      comment: emptyToNull(data.annotationComment),
      text: emptyToNull(data.annotationText),
      position,
      version: item.version,
      sortIndex: data.annotationSortIndex,
      parentKey: parent,
      pageLabel: emptyToNull(data.annotationPageLabel),
      dateAdded: emptyToNull(data.dateAdded),
      dateModified: emptyToNull(data.dateModified),
      authorName: emptyToNull(data.annotationAuthorName),
      isExternal: data.annotationIsExternal ?? null,
      tags: (data.tags ?? []).map((entry) => entry.tag),
      tagDetails: (data.tags ?? []).map((entry) => ({
        name: entry.tag,
        type: entry.type,
      })),
    },
  };
}

function narrowPosition(raw: string): AnnotationPosition {
  const value = parseJson(raw);
  if (typeof value !== "object" || value === null)
    return { kind: "unknown", raw };
  for (const contentType of [
    "application/pdf",
    "application/epub+zip",
    "text/html",
  ]) {
    const position = parseAnnotationPosition(
      value as AnnotationPositionRaw,
      contentType,
    );
    if (position.kind !== "unknown") return position;
  }
  return { kind: "unknown", raw };
}

function pairsWithType(
  type: ResolvedAnnotationTypeName,
  position: AnnotationPosition,
): boolean {
  switch (position.kind) {
    case "pdf-ink":
      return type === "ink";
    case "pdf-text":
      return type === "text";
    case "pdf-rects":
      return type !== "ink" && type !== "text";
    default:
      return true;
  }
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === "" ? null : value;
}

function isDenial(body: string): boolean {
  const denied = parseJson(body);
  return typeof denied === "object" && denied !== null && "denied" in denied;
}

function retryAfter(headers: Headers): Duration.Duration {
  const seconds = Number(headers.get("retry-after"));
  return Number.isSafeInteger(seconds) && seconds > 0
    ? Duration.seconds(seconds)
    : AUTHORIZE_RATE_LIMIT_WINDOW;
}

function issueOf(issues: readonly v.BaseIssue<unknown>[]): string {
  const [first] = issues;
  return first
    ? `${v.getDotPath(first) ?? "body"}: ${first.message}`
    : "unreadable";
}
