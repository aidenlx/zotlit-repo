import { describe, expect, it, vi } from "vitest";

import { yieldToMain } from "@zotlit/plugin-kernel/yield-to-main.ts";
import {
  acceptedSourceIds,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
  SOURCE_MISMATCH_STATUS,
  sourceIdFromUris,
} from "@zotlit/protocol";

import { createLiveUpdateApp } from "./live-update-app.ts";
import type { LiveUpdateAppDeps } from "./live-update-app.ts";

const SOURCE_ID = "a1b2c3d4";

function headers(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
    [SOURCE_ID_HEADER]: SOURCE_ID,
  };
  return Object.assign(base, overrides);
}

function makeDeps(
  overrides: Partial<LiveUpdateAppDeps> = {},
): LiveUpdateAppDeps {
  return {
    enabled: () => true,
    acceptedSourceIds: () => [SOURCE_ID],
    localItemIds: () => true,
    refusedForSource: vi.fn(),
    noteIndex: {
      whenIndexed: () => Promise.resolve(true),
      getIndexedItemKeys: () => ["ABCD2345", "ZZZ99999g17"],
    },
    onNotify: vi.fn(),
    onUpdateMany: vi.fn(),
    onImportNotes: vi.fn(),
    ...overrides,
  };
}

describe("the Live updates toggle", () => {
  it("answers 404 on every route while it is off", async () => {
    const app = createLiveUpdateApp(makeDeps({ enabled: () => false }));

    const status = await Promise.all(
      [
        app.request("/literature-notes", { headers: headers() }),
        app.request("/notify", {
          method: "POST",
          headers: { ...headers(), "content-type": "application/json" },
          body: JSON.stringify({ event: "db/updated" }),
        }),
      ].map(async (res) => (await res).status),
    );

    expect(status).toEqual([404, 404]);
  });
});

describe("the online library as the source", () => {
  it("discards each request that names items of Zotero on this computer, and still answers the note status", async () => {
    const onNotify = vi.fn();
    const onUpdateMany = vi.fn();
    const onImportNotes = vi.fn();
    const refusedForSource = vi.fn();
    const app = createLiveUpdateApp(
      makeDeps({
        localItemIds: () => false,
        refusedForSource,
        onNotify,
        onUpdateMany,
        onImportNotes,
      }),
    );
    const json = { ...headers(), "content-type": "application/json" };

    const update = await app.request("/literature-notes", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ items: [1, 2] }),
    });
    const notes = await app.request("/zotero-notes", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ items: [1], mode: "child" }),
    });
    const notify = await app.request("/notify", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        event: "reader/active",
        itemID: 1,
        attachmentID: 2,
      }),
    });
    const status = await app.request("/literature-notes", {
      headers: headers(),
    });

    expect([update.status, notes.status, notify.status]).toEqual([
      SOURCE_MISMATCH_STATUS,
      SOURCE_MISMATCH_STATUS,
      204,
    ]);
    expect(onUpdateMany).not.toHaveBeenCalled();
    expect(onImportNotes).not.toHaveBeenCalled();
    expect(onNotify).not.toHaveBeenCalled();
    expect(refusedForSource).toHaveBeenCalledTimes(2);
    expect(status.status).toBe(200);
  });
});

describe("GET /literature-notes", () => {
  it("rejects an older protocol version with 426", async () => {
    const app = createLiveUpdateApp(makeDeps());

    const res = await app.request("/literature-notes", {
      headers: headers({ [PROTOCOL_VERSION_HEADER]: "3" }),
    });

    expect(res.status).toBe(426);
  });

  it("rejects a missing protocol version header with 426", async () => {
    const app = createLiveUpdateApp(makeDeps());
    const reqHeaders = headers();
    delete reqHeaders[PROTOCOL_VERSION_HEADER];

    const res = await app.request("/literature-notes", {
      headers: reqHeaders,
    });

    expect(res.status).toBe(426);
  });

  it("discards a request with a mismatched source id via 204", async () => {
    const app = createLiveUpdateApp(makeDeps());

    const res = await app.request("/literature-notes", {
      headers: headers({ [SOURCE_ID_HEADER]: "deadbeef" }),
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("discards a request when the install has no configured source id", async () => {
    const app = createLiveUpdateApp(makeDeps({ acceptedSourceIds: () => [] }));

    const res = await app.request("/literature-notes", {
      headers: headers(),
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("awaits whenIndexed so a startup-time query reflects the post-scan keys", async () => {
    let resolveScan!: (indexed: boolean) => void;
    const scanned = new Promise<boolean>((resolve) => {
      resolveScan = resolve;
    });
    let keys: string[] = [];
    const app = createLiveUpdateApp(
      makeDeps({
        noteIndex: {
          whenIndexed: () => scanned,
          getIndexedItemKeys: () => keys,
        },
      }),
    );

    const pending = app.request("/literature-notes", { headers: headers() });
    keys = ["ABCD2345"];
    resolveScan(true);

    const res = await pending;
    await expect(res.json()).resolves.toEqual({ keys: ["ABCD2345"] });
  });

  it("answers 404, not the keys so far, when the server stops before the scan ends", async () => {
    const app = createLiveUpdateApp(
      makeDeps({
        noteIndex: {
          whenIndexed: () => Promise.resolve(false),
          getIndexedItemKeys: () => ["ABCD2345"],
        },
      }),
    );

    const res = await app.request("/literature-notes", { headers: headers() });

    expect(res.status).toBe(404);
  });
});

describe("POST /notify", () => {
  it("discards a foreign notification via 204", async () => {
    const onNotify = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onNotify }));

    const res = await app.request("/notify", {
      method: "POST",
      headers: {
        ...headers({ [SOURCE_ID_HEADER]: "deadbeef" }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: "db/updated" }),
    });

    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
    expect(onNotify).not.toHaveBeenCalled();
  });

  it("dispatches a valid db/updated event and acks 204", async () => {
    const onNotify = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onNotify }));
    const event = { event: "db/updated" };

    const res = await app.request("/notify", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });

    expect(res.status).toBe(204);
    expect(onNotify).toHaveBeenCalledWith(event);
  });

  it("rejects a malformed body with 400", async () => {
    const onNotify = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onNotify }));

    const res = await app.request("/notify", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ event: "bogus" }),
    });

    expect(res.status).toBe(400);
    expect(onNotify).not.toHaveBeenCalled();
  });
});

describe.each([
  { path: "/literature-notes", body: { items: [1, 2], scope: "full" } },
  { path: "/zotero-notes", body: { items: [1, 2], mode: "note" } },
])("PUT $path source gate", ({ path, body }) => {
  it.each([
    {
      scenario: "a different source",
      accepted: [SOURCE_ID],
      received: "deadbeef",
    },
    { scenario: "no configured source", accepted: [], received: SOURCE_ID },
  ])("discards a batch with $scenario", async ({ accepted, received }) => {
    const onUpdateMany = vi.fn();
    const onImportNotes = vi.fn();
    const app = createLiveUpdateApp(
      makeDeps({
        acceptedSourceIds: () => accepted,
        onUpdateMany,
        onImportNotes,
      }),
    );

    const res = await app.request(path, {
      method: "PUT",
      headers: {
        ...headers({ [SOURCE_ID_HEADER]: received }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    await yieldToMain();
    expect(onUpdateMany).not.toHaveBeenCalled();
    expect(onImportNotes).not.toHaveBeenCalled();
    expect(res.body).toBeNull();
    expect(res.status).toBe(SOURCE_MISMATCH_STATUS);
  });
});

describe("PUT /literature-notes", () => {
  it("fires onUpdateMany with the parsed batch after decoupling", async () => {
    const onUpdateMany = vi.fn();
    const app = createLiveUpdateApp(makeDeps({ onUpdateMany }));
    const body = { items: [1, 2, 3], scope: "full" };

    const res = await app.request("/literature-notes", {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(204);
    await vi.waitFor(() =>
      expect(onUpdateMany).toHaveBeenCalledWith({
        items: [1, 2, 3],
        scope: "full",
      }),
    );
  });
});

describe("PUT /literature-notes from an install with an accented folder name", () => {
  const toFileUri = (path: string) => `file://${encodeURI(path)}`;
  const profile =
    "/Users/me/Library/Application Support/Zotero/Profiles/abcd.default";
  const composed = "/Users/me/Caf\u00e9/Zotero";
  const decomposed = "/Users/me/Cafe\u0301/Zotero";
  const writer = (dataPath: string) =>
    sourceIdFromUris(toFileUri(profile), toFileUri(dataPath));

  it.each([
    {
      scenario: "a composed folder and a decomposed sender",
      local: composed,
      sender: decomposed,
    },
    {
      scenario: "a decomposed folder and a composed sender",
      local: decomposed,
      sender: composed,
    },
  ])("accepts the batch for $scenario", async ({ local, sender }) => {
    const onUpdateMany = vi.fn();
    const app = createLiveUpdateApp(
      makeDeps({
        acceptedSourceIds: () => acceptedSourceIds(profile, local, toFileUri),
        onUpdateMany,
      }),
    );

    const res = await app.request("/literature-notes", {
      method: "PUT",
      headers: {
        ...headers({ [SOURCE_ID_HEADER]: writer(sender) }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: [1], scope: "full" }),
    });

    expect(res.status).toBe(204);
    await vi.waitFor(() =>
      expect(onUpdateMany).toHaveBeenCalledWith({ items: [1], scope: "full" }),
    );
  });

  it("answers a sender from an unrelated folder with the source mismatch status", async () => {
    const onUpdateMany = vi.fn();
    const app = createLiveUpdateApp(
      makeDeps({
        acceptedSourceIds: () =>
          acceptedSourceIds(profile, composed, toFileUri),
        onUpdateMany,
      }),
    );

    const res = await app.request("/literature-notes", {
      method: "PUT",
      headers: {
        ...headers({ [SOURCE_ID_HEADER]: writer("/Users/me/Other/Zotero") }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ items: [1], scope: "full" }),
    });

    await yieldToMain();
    expect(onUpdateMany).not.toHaveBeenCalled();
    expect(res.status).toBe(SOURCE_MISMATCH_STATUS);
  });
});
