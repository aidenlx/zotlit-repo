import { describe, expect, it } from "vitest";

import publicGroup from "@zotlit/db/replica/web-api-public-group.json" with { type: "json" };
import type {
  WebApiCollection,
  WebApiGroup,
  WebApiItem,
} from "@zotlit/zotero-types/web-api";

import { FakeZoteroApi } from "./fake-zotero-api.ts";
import { newApiKey } from "./scenario.ts";

const GROUP = publicGroup.group as unknown as WebApiGroup;
const ITEMS = publicGroup.items as unknown as WebApiItem[];
const COLLECTIONS = publicGroup.collections as unknown as WebApiCollection[];
const BASE = "https://api.zotero.org";

function openApi() {
  const api = new FakeZoteroApi({ userID: 1000001, username: "group-member" });
  const key = newApiKey();
  api.addKey(key, { user: { library: true }, groups: { all: { library: true, write: false } } });
  const group = api.addGroup(GROUP);
  group.load({ library: ITEMS[0]!.library, group: GROUP, collections: COLLECTIONS, items: ITEMS });
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const response = await api.handle(
      new Request(`${BASE}${path}`, {
        headers: { "Zotero-API-Version": "3", "Zotero-API-Key": key, ...headers },
      }),
    );
    const text = await response.text();
    const json = response.headers.get("Content-Type") === "application/json";
    return { response, body: json ? (JSON.parse(text) as unknown) : text || null };
  };
  return { api, key, group, get };
}

function shape(object: { key: string; version: number; data: unknown; meta?: unknown; library: { type: string; id: number; name: string } }) {
  return {
    key: object.key,
    version: object.version,
    data: object.data,
    meta: object.meta,
    library: { type: object.library.type, id: object.library.id, name: object.library.name },
  };
}

describe("the fake Zotero Web API", () => {
  it("serves the real records of the public group in their Web API shape", async () => {
    const { get } = openApi();
    const items = await get(`/groups/${GROUP.id}/items?includeTrashed=1`);
    expect(items.response.headers.get("Last-Modified-Version")).toBe("12");
    expect(items.response.headers.get("Total-Results")).toBe("2");
    expect((items.body as WebApiItem[]).map(shape)).toEqual(
      [...ITEMS].sort((a, b) => a.key.localeCompare(b.key)).map(shape),
    );
    const collections = await get(`/groups/${GROUP.id}/collections`);
    expect((collections.body as WebApiCollection[]).map(shape)).toEqual(COLLECTIONS.map(shape));
    const group = await get(`/groups/${GROUP.id}`);
    expect(group.body).toEqual(GROUP);
  });

  it("answers versions, since, items/top and the deletion log", async () => {
    const { get, group } = openApi();
    expect((await get(`/groups/${GROUP.id}/items?format=versions&includeTrashed=1`)).body).toEqual({
      KC6WFG78: 12,
      QK48VF5T: 9,
    });
    expect((await get(`/groups/${GROUP.id}/items/top?format=versions`)).body).toEqual({ KC6WFG78: 12 });
    group.deleteItem("QK48VF5T");
    group.trashItem("KC6WFG78");
    expect((await get(`/groups/${GROUP.id}/items?format=versions&since=12`)).body).toEqual({});
    expect(
      (await get(`/groups/${GROUP.id}/items?format=versions&since=12&includeTrashed=1`)).body,
    ).toEqual({ KC6WFG78: 14 });
    const deleted = await get(`/groups/${GROUP.id}/deleted?since=12`);
    expect(deleted.body).toEqual({
      collections: [],
      searches: [],
      items: ["QK48VF5T"],
      tags: [],
      settings: [],
    });
    expect(deleted.response.headers.get("Last-Modified-Version")).toBe("14");
    expect((await get(`/groups/${GROUP.id}/deleted`)).response.status).toBe(400);
    group.deleteLogStart = 13;
    expect((await get(`/groups/${GROUP.id}/deleted?since=12`)).response.status).toBe(409);
  });

  it("answers 304 to If-Modified-Since-Version on an unchanged library", async () => {
    const { get } = openApi();
    const unchanged = await get(`/groups/${GROUP.id}/settings?since=12`, {
      "If-Modified-Since-Version": "12",
    });
    expect(unchanged.response.status).toBe(304);
    expect(unchanged.response.headers.get("Last-Modified-Version")).toBe("12");
    const changed = await get(`/groups/${GROUP.id}/settings?since=11`, {
      "If-Modified-Since-Version": "11",
    });
    expect(changed.response.status).toBe(200);
  });

  it("pages with the default limit of 25 and a Link header, and refuses more than 50 keys", async () => {
    const { get, api } = openApi();
    for (let index = 0; index < 60; index++) {
      api.user.putItem({ key: `PAGE${String(index).padStart(4, "0")}`, itemType: "book" });
    }
    const first = await get("/users/1000001/items");
    expect((first.body as unknown[]).length).toBe(25);
    expect(first.response.headers.get("Total-Results")).toBe("60");
    expect(first.response.headers.get("Link")).toBe(
      [
        `<${BASE}/users/1000001/items?start=25>; rel="next"`,
        `<${BASE}/users/1000001/items?start=50>; rel="last"`,
        `<https://www.zotero.org/users/1000001/items>; rel="alternate"`,
      ].join(", "),
    );
    expect((await get("/users/1000001/items?limit=10&start=20")).response.headers.get("Link")).toBe(
      [
        `<${BASE}/users/1000001/items?limit=10>; rel="first"`,
        `<${BASE}/users/1000001/items?limit=10&start=10>; rel="prev"`,
        `<${BASE}/users/1000001/items?limit=10&start=30>; rel="next"`,
        `<${BASE}/users/1000001/items?limit=10&start=50>; rel="last"`,
        `<https://www.zotero.org/users/1000001/items>; rel="alternate"`,
      ].join(", "),
    );
    expect((await get("/users/1000001/items?limit=10&start=50")).response.headers.get("Link")).toBe(
      [
        `<${BASE}/users/1000001/items?limit=10>; rel="first"`,
        `<${BASE}/users/1000001/items?limit=10&start=40>; rel="prev"`,
        `<https://www.zotero.org/users/1000001/items>; rel="alternate"`,
      ].join(", "),
    );
    const empty = await get("/users/1000001/items?itemKey=&limit=50");
    expect((empty.body as unknown[]).length).toBe(50);
    expect(empty.response.headers.get("Total-Results")).toBe("60");
    const keys = Array.from({ length: 30 }, (_, index) => `PAGE${String(index).padStart(4, "0")}`);
    const capped = await get(`/users/1000001/items?itemKey=${keys.join(",")}`);
    expect((capped.body as unknown[]).length).toBe(25);
    expect(capped.response.headers.get("Total-Results")).toBe("30");
    const limited = await get(`/users/1000001/items?itemKey=${keys.join(",")}&limit=30`);
    expect((limited.body as unknown[]).length).toBe(30);
    const tooMany = Array.from({ length: 51 }, (_, index) => `PAGE${String(index).padStart(4, "0")}`);
    expect((await get(`/users/1000001/items?itemKey=${tooMany.join(",")}`)).response.status).toBe(400);
  });

  it("refuses a wrong key, a library outside the key and a write", async () => {
    const { api, get } = openApi();
    const wrong = await api.handle(
      new Request(`${BASE}/keys/current`, {
        headers: { "Zotero-API-Version": "3", "Zotero-API-Key": newApiKey() },
      }),
    );
    expect(wrong.status).toBe(403);
    expect(api.requests.at(-1)).toMatchObject({ key: "invalid", status: 403 });
    const current = await get("/keys/current");
    expect(current.body).toMatchObject({ userID: 1000001, username: "group-member" });
    const reader = newApiKey();
    api.addKey(reader, { user: { library: true }, groups: {} });
    const outside = await api.handle(
      new Request(`${BASE}/groups/${GROUP.id}/items`, {
        headers: { "Zotero-API-Version": "3", "Zotero-API-Key": reader },
      }),
    );
    expect(outside.status).toBe(403);
    const write = await api.handle(
      new Request(`${BASE}/users/1000001/items`, {
        method: "POST",
        headers: { "Zotero-API-Version": "3", "Zotero-API-Key": reader },
        body: "[]",
      }),
    );
    expect(write.status).toBe(405);
  });

  it("hides the notes of the personal library from a key without note access, as the server's item search does, and shows group notes with library access", async () => {
    const { api, key, get } = openApi();
    api.user.putItem({ key: "BOOK0001", itemType: "book", title: "A book" });
    api.user.putItem({ key: "NOTE0001", itemType: "note", note: "<p>A note</p>", parentItem: "BOOK0001" });
    const group = api.groups.get(GROUP.id)!;
    group.putItem({ key: "NOTE0002", itemType: "note", note: "<p>A group note</p>" });
    const listed = async () => ({
      versions: Object.keys((await get("/users/1000001/items?format=versions")).body as object).sort(),
      keyed: ((await get("/users/1000001/items?itemKey=BOOK0001,NOTE0001")).body as WebApiItem[]).map((item) => item.key),
      group: Object.keys((await get(`/groups/${GROUP.id}/items?format=versions`)).body as object),
    });

    expect(await listed()).toEqual({
      versions: ["BOOK0001"],
      keyed: ["BOOK0001"],
      group: expect.arrayContaining(["NOTE0002"]),
    });
    api.addKey(key, { user: { library: true, notes: true }, groups: { all: { library: true, write: false } } });
    expect(await listed()).toMatchObject({ versions: ["BOOK0001", "NOTE0001"], keyed: ["BOOK0001", "NOTE0001"] });
  });

  it("lists the groups of the user as versions with a Total-Results header", async () => {
    const { get } = openApi();
    const groups = await get("/users/1000001/groups?format=versions");
    expect(groups.body).toEqual({ [String(GROUP.id)]: GROUP.version });
    expect(groups.response.headers.get("Total-Results")).toBe("1");
    expect(groups.response.headers.get("Last-Modified-Version")).toBeNull();
  });

  it("sends the CORS headers of the real API to a request with an Origin, and answers the preflight without a key", async () => {
    const { api, get } = openApi();
    const origin = { Origin: "app://obsidian.md" };
    for (const answer of [
      await get("/users/1000001/items?limit=1", origin),
      await get(`/groups/${GROUP.id}/settings`, { ...origin, "If-Modified-Since-Version": "12" }),
      await get("/keys/current", { ...origin, "Zotero-API-Key": newApiKey() }),
    ]) {
      expect(answer.response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(answer.response.headers.get("Access-Control-Expose-Headers")).toContain(
        "Backoff, ETag, Last-Modified-Version, Link, Retry-After, Total-Results",
      );
    }
    expect((await get("/users/1000001/items?limit=1")).response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const preflight = await api.handle(
      new Request(`${BASE}/users/1000001/items?limit=1`, {
        method: "OPTIONS",
        headers: {
          ...origin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers":
            "zotero-api-key,zotero-api-version,if-modified-since-version,zotero-schema-version",
        },
      }),
    );
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase().split(", ")).toEqual(
      expect.arrayContaining(["zotero-api-key", "zotero-api-version", "if-modified-since-version", "zotero-schema-version"]),
    );
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});
