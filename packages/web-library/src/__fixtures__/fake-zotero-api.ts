import { regex } from "arkregex";

import type {
  WebApiCollection,
  WebApiCollectionData,
  WebApiGroup,
  WebApiItem,
  WebApiItemData,
  WebApiKey,
  WebApiLibrary,
} from "@zotlit/zotero-types/web-api";

import type { WebApiFetch } from "#api-client.ts";

const SAFELISTED_RESPONSE_HEADERS = [
  "cache-control",
  "content-language",
  "content-length",
  "content-type",
  "expires",
  "last-modified",
  "pragma",
];

export function crossOriginFetch(fetch: WebApiFetch): WebApiFetch {
  return async (url, init) => {
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Origin: "app://obsidian.md" },
    });
    const exposed = new Set(
      SAFELISTED_RESPONSE_HEADERS.concat(
        (response.headers.get("Access-Control-Expose-Headers") ?? "")
          .split(",")
          .map((name) => name.trim().toLowerCase()),
      ),
    );
    const headers = new Headers();
    for (const [name, value] of response.headers) {
      if (exposed.has(name)) headers.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers });
  };
}

export const FAKE_SCHEMA_VERSION = 42;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
export const MAX_KEYS_PER_REQUEST = 50;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers":
    "Backoff, ETag, Last-Modified-Version, Link, Retry-After, Total-Results, Zotero-API-Version",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, If-Match, If-None-Match, If-Modified-Since-Version, If-Unmodified-Since-Version, Zotero-API-Key, Zotero-API-Version, Zotero-Schema-Version, Zotero-Write-Token",
  "Access-Control-Allow-Methods": "HEAD, GET, POST, PUT, PATCH, DELETE",
  "Access-Control-Max-Age": "86400",
};

export interface FakeLibraryRef {
  readonly type: "user" | "group";
  readonly id: number;
}

export interface FakeLibraryRecords {
  readonly library: WebApiLibrary;
  readonly group: WebApiGroup | null;
  readonly collections: readonly WebApiCollection[];
  readonly items: readonly WebApiItem[];
}

export interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly ifModifiedSinceVersion: number | null;
  readonly key: "valid" | "invalid" | "absent";
  readonly headers: Readonly<Record<string, string>>;
  status: number | null;
}

export interface FakeAnswer {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface FakeRule {
  readonly match: (request: FakeRequest) => boolean;
  readonly times?: number;
  readonly before?: (api: FakeZoteroApi) => void;
  readonly answer?: FakeAnswer;
  readonly backoff?: number;
  readonly truncate?: number;
}

interface StoredObject<Data> {
  version: number;
  data: Data;
  meta: object;
}

export interface FakeItemInput {
  readonly key: string;
  readonly itemType: string;
  readonly [field: string]: unknown;
}

interface Deletion {
  readonly objectType: "collection" | "item" | "search" | "setting";
  readonly key: string;
  readonly version: number;
}

export class FakeLibrary {
  readonly ref: FakeLibraryRef;
  readonly name: string;
  version = 0;
  readonly collections = new Map<string, StoredObject<WebApiCollectionData>>();
  readonly items = new Map<string, StoredObject<WebApiItemData>>();
  readonly settings = new Map<string, { value: unknown; version: number }>();
  readonly deletions: Deletion[] = [];
  deleteLogStart = 0;
  group: WebApiGroup | null;

  constructor(ref: FakeLibraryRef, name: string, group: WebApiGroup | null) {
    this.ref = ref;
    this.name = name;
    this.group = group;
  }

  load(records: FakeLibraryRecords): void {
    for (const collection of records.collections) {
      const version = Math.max(collection.version, 1);
      this.collections.set(collection.key, {
        version,
        data: { ...collection.data, version },
        meta: collection.meta ?? {},
      });
      this.version = Math.max(this.version, version);
    }
    for (const item of records.items) {
      const version = Math.max(item.version, 1);
      this.items.set(item.key, {
        version,
        data: { ...item.data, version },
        meta: item.meta ?? {},
      });
      this.version = Math.max(this.version, version);
    }
  }

  #bump(): number {
    this.version += 1;
    return this.version;
  }

  putItem(data: FakeItemInput, meta: object = {}): number {
    const version = this.#bump();
    const previous = this.items.get(data.key);
    this.items.set(data.key, {
      version,
      data: { ...data, version },
      meta: previous?.meta ?? meta,
    });
    return version;
  }

  updateItem(key: string, change: Partial<WebApiItemData>): number {
    const stored = this.items.get(key);
    if (!stored) throw new Error(`The fake library has no item ${key}`);
    return this.putItem({ ...stored.data, ...change, key });
  }

  trashItem(key: string): number {
    return this.updateItem(key, { deleted: 1 });
  }

  restoreItem(key: string): number {
    const stored = this.items.get(key);
    if (!stored) throw new Error(`The fake library has no item ${key}`);
    const { deleted: _deleted, ...data } = stored.data;
    return this.putItem(data);
  }

  deleteItem(key: string): number {
    const version = this.#bump();
    const doomed = [key];
    for (let index = 0; index < doomed.length; index++) {
      for (const [childKey, child] of this.items) {
        if (child.data.parentItem === doomed[index]) doomed.push(childKey);
      }
    }
    for (const doomedKey of doomed) {
      if (this.items.delete(doomedKey)) {
        this.deletions.push({ objectType: "item", key: doomedKey, version });
      }
    }
    return version;
  }

  putSetting(key: string, value: unknown): number {
    const version = this.#bump();
    this.settings.set(key, { value, version });
    return version;
  }

  deleteSetting(key: string): number {
    const version = this.#bump();
    this.settings.delete(key);
    this.deletions.push({ objectType: "setting", key, version });
    return version;
  }

  putCollection(data: Omit<WebApiCollectionData, "version">): number {
    const version = this.#bump();
    const previous = this.collections.get(data.key);
    this.collections.set(data.key, {
      version,
      data: { ...data, version },
      meta: previous?.meta ?? {},
    });
    return version;
  }

  deleteCollection(key: string): number {
    const version = this.#bump();
    const doomed = new Set([key]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [childKey, child] of this.collections) {
        if (
          child.data.parentCollection !== false &&
          doomed.has(child.data.parentCollection) &&
          !doomed.has(childKey)
        ) {
          doomed.add(childKey);
          grew = true;
        }
      }
    }
    for (const doomedKey of doomed) {
      this.collections.delete(doomedKey);
      this.deletions.push({ objectType: "collection", key: doomedKey, version });
    }
    for (const item of this.items.values()) {
      const collections = item.data.collections ?? [];
      if (collections.some((member) => doomed.has(member))) {
        item.version = version;
        item.data = {
          ...item.data,
          version,
          collections: collections.filter((member) => !doomed.has(member)),
        };
      }
    }
    return version;
  }

  libraryJSON(baseUrl: string): WebApiLibrary {
    const path =
      this.ref.type === "user" ? `users/${this.ref.id}` : `groups/${this.ref.id}`;
    return {
      type: this.ref.type,
      id: this.ref.id,
      name: this.name,
      links: {
        alternate: {
          href: `${baseUrl.replace("api.", "www.")}/${path}`,
          type: "text/html",
        },
      },
    };
  }
}

export interface FakeKeyGrant {
  readonly access: WebApiKey["access"];
  readonly userID: number;
  readonly username: string;
}

const USER_GROUPS_RE = regex("^/users/(?<userID>[0-9]+)/groups$");
const GROUP_RE = regex("^/groups/(?<groupID>[0-9]+)$");
const SCOPED_RE = regex("^/(?<kind>users|groups)/(?<id>[0-9]+)/(?<target>.+)$");

export interface FakeZoteroApiOptions {
  readonly userID: number;
  readonly username: string;
  readonly baseUrl?: string;
}

interface Waiter {
  readonly predicate: (api: FakeZoteroApi) => boolean;
  readonly resolve: () => void;
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, value] of headers) {
    if (name === "zotero-api-key" || name === "authorization") continue;
    record[name] = value;
  }
  return record;
}

export class FakeZoteroApi {
  readonly userID: number;
  readonly username: string;
  baseUrl: string;
  readonly keys = new Map<string, FakeKeyGrant>();
  readonly user: FakeLibrary;
  readonly groups = new Map<number, FakeLibrary>();
  readonly requests: FakeRequest[] = [];
  readonly #rules: { rule: FakeRule; left: number }[] = [];
  readonly #holds: { match: (request: FakeRequest) => boolean; gate: Promise<void> }[] = [];
  readonly #waiters: Waiter[] = [];
  inFlight = 0;
  maxInFlight = 0;
  schemaVersion = FAKE_SCHEMA_VERSION;

  constructor({
    userID,
    username,
    baseUrl = "https://api.zotero.org",
  }: FakeZoteroApiOptions) {
    this.userID = userID;
    this.username = username;
    this.baseUrl = baseUrl;
    this.user = new FakeLibrary({ type: "user", id: userID }, username, null);
  }

  addKey(
    key: string,
    access: WebApiKey["access"],
    account: { readonly userID: number; readonly username: string } = this,
  ): void {
    this.keys.set(key, {
      access,
      userID: account.userID,
      username: account.username,
    });
  }

  revokeKey(key: string): void {
    this.keys.delete(key);
  }

  loadLibraries(records: readonly FakeLibraryRecords[]): void {
    for (const record of records) {
      if (record.group) {
        this.addGroup(record.group).load(record);
      } else {
        this.user.load(record);
      }
    }
  }

  addGroup(group: WebApiGroup): FakeLibrary {
    const library = new FakeLibrary(
      { type: "group", id: group.id },
      group.data.name,
      group,
    );
    this.groups.set(group.id, library);
    return library;
  }

  leaveGroup(groupID: number): void {
    this.groups.delete(groupID);
  }

  library(ref: FakeLibraryRef): FakeLibrary {
    const library = ref.type === "user" ? this.user : this.groups.get(ref.id);
    if (!library) throw new Error(`The fake API has no library ${ref.type} ${ref.id}`);
    return library;
  }

  inject(rule: FakeRule): void {
    this.#rules.push({ rule, left: rule.times ?? 1 });
  }

  hold(match: (request: FakeRequest) => boolean): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hold = { match, gate };
    this.#holds.push(hold);
    return () => {
      this.#holds.splice(this.#holds.indexOf(hold), 1);
      release();
    };
  }

  until(predicate: (api: FakeZoteroApi) => boolean): Promise<void> {
    if (predicate(this)) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push({ predicate, resolve }));
  }

  #notify(): void {
    for (const waiter of this.#waiters.slice()) {
      if (waiter.predicate(this)) {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  }

  clearRequests(): void {
    this.requests.length = 0;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const presented =
      request.headers.get("Zotero-API-Key") ??
      request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
      null;
    const since = request.headers.get("If-Modified-Since-Version");
    const entry: FakeRequest = {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      ifModifiedSinceVersion: since === null ? null : Number(since),
      key:
        presented === null
          ? "absent"
          : this.keys.has(presented)
            ? "valid"
            : "invalid",
      headers: headerRecord(request.headers),
      status: null,
    };
    this.requests.push(entry);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.#notify();
    try {
      for (const hold of this.#holds.slice()) {
        if (hold.match(entry)) await hold.gate;
      }
      const response = this.#answer(entry, presented);
      entry.status = response.status;
      return response;
    } finally {
      this.inFlight -= 1;
      this.#notify();
    }
  }

  #takeRule(entry: FakeRequest): FakeRule | undefined {
    const found = this.#rules.find(({ rule, left }) => left > 0 && rule.match(entry));
    if (!found) return undefined;
    found.left -= 1;
    return found.rule;
  }

  #answer(entry: FakeRequest, presented: string | null): Response {
    const cors = entry.headers.origin === undefined ? {} : CORS_HEADERS;
    if (entry.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: cors });
    }
    const rule = this.#takeRule(entry);
    rule?.before?.(this);
    if (rule?.answer) {
      return new Response(rule.answer.body ?? null, {
        status: rule.answer.status,
        headers: { ...this.#baseHeaders(), ...cors, ...rule.answer.headers },
      });
    }
    const head = entry.method === "HEAD";
    const answer = this.#route(
      head ? { ...entry, method: "GET" } : entry,
      presented,
      rule?.truncate,
    );
    const headers = new Headers({
      ...this.#baseHeaders(),
      ...cors,
      ...answer.headers,
    });
    if (rule?.backoff !== undefined) headers.set("Backoff", String(rule.backoff));
    return new Response(
      head || answer.status === 304 ? null : (answer.body ?? null),
      { status: answer.status, headers },
    );
  }

  #baseHeaders(): Record<string, string> {
    return {
      "Zotero-API-Version": "3",
      "Zotero-Schema-Version": String(this.schemaVersion),
    };
  }

  #route(
    entry: FakeRequest,
    presented: string | null,
    truncate: number | undefined,
  ): FakeAnswer {
    if (entry.method !== "GET") {
      return text(405, "The fake Zotero API is read-only");
    }
    if (entry.path === "/itemTypes" && presented === null) {
      return json(200, []);
    }
    if (entry.headers["zotero-api-version"] !== "3") {
      return text(400, "The fake Zotero API speaks version 3 only");
    }
    const grant = presented === null ? undefined : this.keys.get(presented);
    if (presented !== null && grant === undefined) {
      return text(403, "Invalid key");
    }
    if (entry.path === "/keys/current") {
      if (grant === undefined) return text(403, "Forbidden");
      return json(200, {
        key: presented,
        userID: grant.userID,
        username: grant.username,
        displayName: "",
        access: grant.access,
      });
    }
    const userGroups = USER_GROUPS_RE.exec(entry.path);
    if (userGroups) {
      if (
        grant === undefined ||
        Number(userGroups.groups.userID) !== grant.userID ||
        grant.userID !== this.userID
      ) {
        return text(403, "Forbidden");
      }
      if (entry.query.format !== "versions") {
        return text(400, "The fake Zotero API lists groups as versions only");
      }
      return json(
        200,
        Object.fromEntries(
          [...this.groups.values()].map((group) => [
            String(group.ref.id),
            group.group?.version ?? 0,
          ]),
        ),
        { "Total-Results": String(this.groups.size) },
      );
    }
    const groupOnly = GROUP_RE.exec(entry.path);
    if (groupOnly) {
      const group = this.groups.get(Number(groupOnly.groups.groupID));
      if (!group?.group) return text(404, "Not found");
      if (!canRead(grant, group.ref)) return text(403, "Forbidden");
      return json(200, group.group, {
        "Last-Modified-Version": String(group.group.version),
      });
    }
    const scoped = SCOPED_RE.exec(entry.path);
    if (!scoped) return text(404, "Not found");
    const ref: FakeLibraryRef = {
      type: scoped.groups.kind === "users" ? "user" : "group",
      id: Number(scoped.groups.id),
    };
    const library =
      ref.type === "user"
        ? ref.id === this.userID
          ? this.user
          : undefined
        : this.groups.get(ref.id);
    if (!library) return text(404, "Not found");
    if (!canRead(grant, ref)) return text(403, "Forbidden");
    const versionHeader = { "Last-Modified-Version": String(library.version) };
    if (
      entry.ifModifiedSinceVersion !== null &&
      library.version <= entry.ifModifiedSinceVersion
    ) {
      return { status: 304, headers: versionHeader };
    }
    return this.#libraryRoute(library, {
      target: scoped.groups.target,
      entry,
      truncate,
      notes: canReadNotes(grant, ref),
    });
  }

  #libraryRoute(
    library: FakeLibrary,
    {
      target,
      entry,
      truncate,
      notes,
    }: { target: string; entry: FakeRequest; truncate: number | undefined; notes: boolean },
  ): FakeAnswer {
    const versionHeader = { "Last-Modified-Version": String(library.version) };
    const since = Number(entry.query.since ?? 0);
    switch (target) {
      case "settings":
        return json(
          200,
          Object.fromEntries(
            [...library.settings].filter(([, setting]) => setting.version > since),
          ),
          versionHeader,
        );
      case "deleted": {
        if (entry.query.since === undefined) {
          return text(400, "'since' parameter must be provided");
        }
        if (since < library.deleteLogStart) {
          return text(409, "'since' is earlier than the beginning of the delete log");
        }
        const keys = (objectType: Deletion["objectType"]) => [
          ...new Set(
            library.deletions
              .filter(
                (deletion) =>
                  deletion.objectType === objectType && deletion.version > since,
              )
              .map((deletion) => deletion.key),
          ),
        ];
        return json(
          200,
          {
            collections: keys("collection"),
            searches: keys("search"),
            items: keys("item"),
            tags: [],
            settings: keys("setting"),
          },
          versionHeader,
        );
      }
      case "searches":
        return entry.query.format === "versions"
          ? json(200, {}, { ...versionHeader, "Total-Results": "0" })
          : json(200, [], { ...versionHeader, "Total-Results": "0" });
      case "collections":
        return this.#list(library, { objectType: "collection", entry, truncate, target, notes });
      case "items":
      case "items/top":
      case "items/trash":
        return this.#list(library, { objectType: "item", entry, truncate, target, notes });
      default:
        return text(404, "Not found");
    }
  }

  #list(
    library: FakeLibrary,
    {
      objectType,
      entry,
      truncate,
      target,
      notes,
    }: {
      objectType: "collection" | "item";
      entry: FakeRequest;
      truncate: number | undefined;
      target: string;
      notes: boolean;
    },
  ): FakeAnswer {
    const { query } = entry;
    const since = Number(query.since ?? 0);
    const keyParam = query[`${objectType}Key`];
    const keys = keyParam ? keyParam.split(",").filter(Boolean) : undefined;
    if (keys && keys.length > MAX_KEYS_PER_REQUEST) {
      return text(400, `Cannot request more than ${MAX_KEYS_PER_REQUEST} keys at once`);
    }
    const source = objectType === "item" ? library.items : library.collections;
    let matched = [...source.entries()].filter(([key, stored]) => {
      if (stored.version <= since) return false;
      if (keys && !keys.includes(key)) return false;
      if (objectType === "item") {
        const data = stored.data as WebApiItemData;
        if (!notes && data.itemType === "note") return false;
        const trashed = !!data.deleted;
        if (target === "items/trash") return trashed;
        if (trashed && query.includeTrashed !== "1") return false;
        if (target === "items/top" && data.parentItem) return false;
      }
      return true;
    });
    matched.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const versionHeader = { "Last-Modified-Version": String(library.version) };
    if (query.format === "versions") {
      return json(
        200,
        Object.fromEntries(matched.map(([key, stored]) => [key, stored.version])),
        { ...versionHeader, "Total-Results": String(matched.length) },
      );
    }
    const total = matched.length;
    const limit = Math.min(Number(query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const start = Number(query.start ?? 0);
    matched = matched.slice(start, start + Math.min(limit, truncate ?? limit));
    const headers: Record<string, string> = {
      ...versionHeader,
      "Total-Results": String(total),
    };
    const link = this.#link(entry, { start, limit, total });
    if (link) headers.Link = link;
    return json(
      200,
      matched.map(([key, stored]) =>
        this.#object(library, { objectType, key, stored }),
      ),
      headers,
    );
  }

  #link(
    entry: FakeRequest,
    { start, limit, total }: { start: number; limit: number; total: number },
  ): string | undefined {
    const page = (offset: number) => {
      const params = new URLSearchParams(entry.query);
      if (offset === 0) params.delete("start");
      else params.set("start", String(offset));
      const search = params.toString();
      return `${this.baseUrl}${entry.path}${search ? `?${search}` : ""}`;
    };
    const rels: string[] = [];
    if (start > 0) {
      rels.push(`<${page(0)}>; rel="first"`);
      rels.push(`<${page(Math.max(start - limit, 0))}>; rel="prev"`);
    }
    if (start + limit < total) {
      rels.push(`<${page(start + limit)}>; rel="next"`);
      rels.push(`<${page(Math.floor((total - 1) / limit) * limit)}>; rel="last"`);
    }
    rels.push(`<${this.baseUrl.replace("api.", "www.")}${entry.path}>; rel="alternate"`);
    return rels.join(", ");
  }

  #object(
    library: FakeLibrary,
    {
      objectType,
      key,
      stored,
    }: {
      objectType: "collection" | "item";
      key: string;
      stored: StoredObject<WebApiItemData | WebApiCollectionData>;
    },
  ): WebApiItem | WebApiCollection {
    const prefix =
      library.ref.type === "user"
        ? `users/${library.ref.id}`
        : `groups/${library.ref.id}`;
    const plural = objectType === "item" ? "items" : "collections";
    return {
      key,
      version: stored.version,
      library: library.libraryJSON(this.baseUrl),
      links: {
        self: {
          href: `${this.baseUrl}/${prefix}/${plural}/${key}`,
          type: "application/json",
        },
      },
      meta: stored.meta,
      data: stored.data,
    } as WebApiItem | WebApiCollection;
  }
}

function canRead(grant: FakeKeyGrant | undefined, ref: FakeLibraryRef): boolean {
  if (grant === undefined) return false;
  const { access } = grant;
  if (ref.type === "user") return grant.userID === ref.id && !!access.user?.library;
  const groups = access.groups ?? {};
  return !!(groups.all?.library || groups[String(ref.id)]?.library);
}

function canReadNotes(grant: FakeKeyGrant | undefined, ref: FakeLibraryRef): boolean {
  if (!canRead(grant, ref)) return false;
  return ref.type === "group" || !!grant!.access.user?.notes;
}

function text(status: number, body: string): FakeAnswer {
  return { status, headers: { "Content-Type": "text/plain" }, body };
}

function json(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): FakeAnswer {
  return {
    status,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}
