import { Effect, Stream } from "effect";
import { get } from "node:http";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";

import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { subscribe } from "@zotlit/plugin-kernel/effect-stream.ts";
import {
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
  SOURCE_ID_HEADER,
} from "@zotlit/protocol";

import { buildLocalServer } from "./__fixtures__.ts";

import { platformSettings } from "#__fixtures__/platform-settings.ts";

const SOURCE_ID = "a1b2c3d4";

const companionHeaders = {
  [PROTOCOL_VERSION_HEADER]: String(PROTOCOL_VERSION),
  [SOURCE_ID_HEADER]: SOURCE_ID,
};

async function whenListening(
  service: Awaited<ReturnType<typeof buildLocalServer>>,
): Promise<number> {
  const bound = service.runtime.runSync(service.server.effectivePort);
  if (bound !== null) return bound;
  return await new Promise<number>((resolve) => {
    const off = subscribe(
      service.runtime,
      Stream.drop(service.server.effectivePortChanges, 1),
      (port) => {
        if (port === null) return;
        off();
        resolve(port);
      },
    );
  });
}

async function whenClosed(
  service: Awaited<ReturnType<typeof buildLocalServer>>,
): Promise<void> {
  if (service.runtime.runSync(service.server.effectivePort) === null) return;
  await new Promise<void>((resolve) => {
    const off = subscribe(
      service.runtime,
      Stream.drop(service.server.effectivePortChanges, 1),
      (port) => {
        if (port !== null) return;
        off();
        resolve();
      },
    );
  });
}

it("serves without taking over the window's Request and Response", async () => {
  const nativeRequest = globalThis.Request;
  const nativeResponse = globalThis.Response;
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": 0,
      },
    },
    stack,
  );
  const port = await whenListening(service);
  expect(port).toBeGreaterThan(0);

  expect(globalThis.Request).toBe(nativeRequest);
  expect(globalThis.Response).toBe(nativeResponse);

  const res = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });

  expect(res.status).toBe(200);
  await expect(res.json()).resolves.toEqual({ keys: ["ABCD2345"] });
});

it("keeps the listener up while Live updates is off", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.live-update": false,
        "server.port": 0,
      },
    },
    stack,
  );
  const port = await whenListening(service);

  expect(service.runtime.runSync(service.server.effectivePort)).toBe(port);
  expect(service.runtime.runSync(service.server.available)).toBe(false);
  const refused = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(refused.status).toBe(404);

  service.runtime.runSync(
    service.settings.update({ "server.live-update": true }),
  );
  expect(service.runtime.runSync(service.server.available)).toBe(true);
  expect(service.runtime.runSync(service.server.effectivePort)).toBe(port);
  const answered = await fetch(`http://127.0.0.1:${port}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(answered.status).toBe(200);
});

it("binds the next free port when the configured one is taken", async () => {
  await using holders = new AsyncDisposableStack();
  let port: number;
  do {
    const holder = holders.use(createServer());
    await new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.listen(0, "127.0.0.1", resolve);
    });
    port = (holder.address() as AddressInfo).port;
  } while (port > 65535 - 9);
  await using serviceStack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": port,
      },
    },
    serviceStack,
  );
  const bound = await whenListening(service);

  expect(bound).toBeGreaterThan(port);
  expect(bound).toBeLessThanOrEqual(port + 9);
  expect(service.runtime.runSync(service.server.effectivePort)).toBe(bound);
  const res = await fetch(`http://127.0.0.1:${bound}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(res.status).toBe(200);
});

it("unloads cleanly when no port in the range can bind", async () => {
  const stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": 0,
        "server.hostname": "203.0.113.1",
      },
    },
    stack,
  );
  const bridge = effectBridge(service.runtime);
  await stack.disposeAsync();

  expect(bridge.runSync(service.server.effectivePort)).toBe(null);
  expect(bridge.runSync(service.server.available)).toBe(false);
});

it("closes and reopens the listener as the server toggle changes", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": 0,
      },
    },
    stack,
  );
  const port = await whenListening(service);

  service.runtime.runSync(service.settings.update({ "server.enabled": false }));
  await whenClosed(service);
  expect(service.runtime.runSync(service.server.effectivePort)).toBe(null);
  await expect(
    fetch(`http://127.0.0.1:${port}/literature-notes`, {
      headers: companionHeaders,
    }),
  ).rejects.toThrow();

  service.runtime.runSync(service.settings.update({ "server.enabled": true }));
  const reopenedPort = await whenListening(service);
  expect(reopenedPort).toBeGreaterThan(0);
  const res = await fetch(`http://127.0.0.1:${reopenedPort}/literature-notes`, {
    headers: companionHeaders,
  });
  expect(res.status).toBe(200);
});

it("answers a note-status query as unavailable when unload ends the first scan", async () => {
  const stack = new AsyncDisposableStack();
  const waiting = Promise.withResolvers<void>();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": 0,
      },
    },
    stack,
    {
      whenIndexed: Effect.sync(() => waiting.resolve()).pipe(
        Effect.andThen(Effect.never),
      ),
    },
  );
  const port = await whenListening(service);

  const status = new Promise<number | undefined>((resolve, reject) => {
    get(
      `http://127.0.0.1:${port}/literature-notes`,
      { headers: companionHeaders, agent: false },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    ).on("error", reject);
  });
  await waiting.promise;
  await stack.disposeAsync();

  expect(await status).toBe(404);
});

async function notify(port: number, event: unknown): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/notify`, {
    method: "POST",
    headers: { ...companionHeaders, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  return res.status;
}

const READER_ACTIVE = {
  event: "reader/active",
  itemID: 11,
  attachmentID: 22,
  selected: [33],
};

it("keeps the last reader target and flags it closed on reader/inactive", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": 0,
      },
    },
    stack,
  );
  const port = await whenListening(service);
  const closedEdges: boolean[] = [];
  stack.defer(
    subscribe(
      service.runtime,
      Stream.drop(service.server.readerClosedChanges, 1),
      (closed) => closedEdges.push(closed),
    ),
  );

  expect(await notify(port, READER_ACTIVE)).toBe(204);
  expect(service.runtime.runSync(service.server.readerTarget)).toEqual({
    itemID: 11,
    attachmentID: 22,
    selected: [33],
  });
  expect(service.runtime.runSync(service.server.readerClosed)).toBe(false);

  expect(await notify(port, { event: "reader/inactive" })).toBe(204);
  expect(service.runtime.runSync(service.server.readerTarget)).toEqual({
    itemID: 11,
    attachmentID: 22,
    selected: [33],
  });
  expect(service.runtime.runSync(service.server.readerClosed)).toBe(true);

  expect(await notify(port, { event: "reader/inactive" })).toBe(204);
  expect(await notify(port, { ...READER_ACTIVE, attachmentID: 44 })).toBe(204);
  expect(service.runtime.runSync(service.server.readerClosed)).toBe(false);
  expect(
    service.runtime.runSync(service.server.readerTarget)?.attachmentID,
  ).toBe(44);
  expect(closedEdges).toEqual([true, false]);
});

it("holds the reader target past a listener that stops answering", async () => {
  await using stack = new AsyncDisposableStack();
  const service = await buildLocalServer(
    {
      definition: platformSettings,
      overrides: {
        "server.enabled": true,
        "server.port": 0,
      },
    },
    stack,
  );
  const port = await whenListening(service);
  expect(await notify(port, READER_ACTIVE)).toBe(204);

  service.runtime.runSync(
    service.settings.update({ "server.live-update": false }),
  );
  expect(service.runtime.runSync(service.server.available)).toBe(false);
  expect(
    service.runtime.runSync(service.server.readerTarget)?.attachmentID,
  ).toBe(22);
});
