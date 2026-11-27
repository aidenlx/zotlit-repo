import { DateTime, Duration } from "effect";
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vitest";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { ClientOptions, ZoteroAnswers } from "./__fixtures__.ts";
import {
  authorized,
  denied,
  keyRejected,
  libraryReadOnly,
  localApiClient,
  localApiDisabled,
  rateLimited,
  rootOk,
  serverChanged,
  unreachable,
  writeAccepted,
  SERVER_ID,
} from "./__fixtures__.ts";
import type { ZoteroLocalApi } from "./service.ts";

const ITEM_PATH = "/api/users/0/items/PUPR5FG5";
const PERSONAL = "users/0";

const OTHER_SERVER_ID = "Zzzz11119999";

it("asks Zotero under the one Client Name, and only when a gesture asks", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack);

  expect(requests).toHaveLength(0);
  await bridge.runPromise(service.authorize);

  const authorize = requests.at(-1)!;
  expect(authorize.method).toBe("POST");
  expect(authorize.url.pathname).toBe("/api/local/authorize");
  expect(JSON.parse(authorize.body!)).toEqual({
    appName: "ZotLit for Obsidian",
  });
  expect(authorize.headers.get("content-type")).toBe("application/json");
  expect(authorize.headers.get("zotero-server-id")).toBe(SERVER_ID);
  expect(authorize.headers.get("zotero-allowed-request")).toBe("1");
  expect(requests.map(({ url }) => url.pathname)).toEqual([
    "/api/",
    "/api/local/authorize",
  ]);
});

it("refuses an Allow, and keeps no key to send", async () => {
  await using stack = new AsyncDisposableStack();
  const confirmGrant = vi.fn(() => true);
  const { service, bridge, requests, credentials } = await setup(
    stack,
    {
      authorize: () => authorized({ remember: false }),
      write: () => writeAccepted(),
    },
    { confirmGrant },
  );

  const grant = await bridge.runPromise(service.authorize);
  const sent = requests.length;
  const write = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
      body: '{"annotationColor":"#ff6666"}',
    }),
  );

  expect(grant).toEqual({ failure: { kind: "not-remembered" } });
  expect(confirmGrant).not.toHaveBeenCalled();
  expect(credentials.writes).toEqual([]);
  expect(await bridge.runPromise(service.remembered)).toBe(false);
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(write).toEqual({ failure: { kind: "unauthorized" } });
  expect(requests.slice(sent)).toEqual([]);
});

it("refuses an Always Allow that the device cannot save", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, credentials, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
  });
  credentials.remember.mockRejectedValueOnce(new Error("Keychain locked"));

  const grant = await bridge.runPromise(service.authorize);
  const sent = requests.length;
  const write = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(grant).toEqual({ failure: { kind: "not-saved" } });
  expect(credentials.record).toBeNull();
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(write).toEqual({ failure: { kind: "unauthorized" } });
  expect(requests.slice(sent)).toEqual([]);
});

it("writes an Always Allow to the store and never holds it in memory", async () => {
  await using stack = new AsyncDisposableStack();
  const { credentials, requests, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
  });

  const grant = await bridge.runPromise(service.authorize);
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(grant).toEqual({ value: undefined });
  expect(credentials.record).toEqual({
    serverID: SERVER_ID,
    key: "XmplApiKey0000000000000000000001",
  });
  expect(credentials.read).toHaveBeenCalledTimes(3);
  expect(
    requests
      .filter(({ method }) => method === "PATCH")
      .map(({ headers }) => headers.get("zotero-api-key")),
  ).toEqual([
    "XmplApiKey0000000000000000000001",
    "XmplApiKey0000000000000000000001",
  ]);
});

it("raises no second dialog once an authorization is remembered", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(
    stack,
    { authorize: () => authorized({ remember: true }) },
    { key: "XmplApiKey0000000000000000000001" },
  );

  const grant = await bridge.runPromise(service.authorize);

  expect(grant).toEqual({ value: undefined });
  expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/"]);
});

const rememberedGrants: [string, () => Response][] = [
  ["Always Allow", () => authorized({ remember: true })],
  [
    "a dismissed dialog",
    () =>
      authorized({ remember: true, key: "XmplApiKey0000000000000000000003" }),
  ],
];

it.each(rememberedGrants)(
  "keeps editing off when the researcher declines the grant from %s",
  async (_outcome, answer) => {
    await using stack = new AsyncDisposableStack();
    const confirmGrant = vi.fn(() => false);
    const { service, bridge, requests, credentials } = await setup(
      stack,
      { authorize: answer },
      { confirmGrant },
    );

    const grant = await bridge.runPromise(service.authorize);
    const sent = requests.length;
    const write = await bridge.runPromise(
      service.authorizedSend(ITEM_PATH, { library: PERSONAL, method: "PATCH" }),
    );

    expect(grant).toEqual({ failure: { kind: "not-confirmed" } });
    expect(confirmGrant).toHaveBeenCalledOnce();
    expect(credentials.writes).toEqual([]);
    expect(await bridge.runPromise(service.remembered)).toBe(false);
    expect(capabilityInput(service, bridge).authorized).toBe(false);
    expect(write).toEqual({ failure: { kind: "unauthorized" } });
    expect(requests.slice(sent)).toEqual([]);
  },
);

it.each(rememberedGrants)(
  "saves the grant from %s when the researcher confirms it",
  async (_outcome, answer) => {
    await using stack = new AsyncDisposableStack();
    const confirmGrant = vi.fn(() => true);
    const { service, bridge, credentials } = await setup(
      stack,
      { authorize: answer },
      { confirmGrant },
    );

    expect(await bridge.runPromise(service.authorize)).toEqual({
      value: undefined,
    });
    expect(confirmGrant).toHaveBeenCalledOnce();
    expect(credentials.writes).toEqual([
      { serverID: SERVER_ID, key: expect.any(String) },
    ]);
    expect(await bridge.runPromise(service.remembered)).toBe(true);
    expect(capabilityInput(service, bridge).authorized).toBe(true);
  },
);

it("keeps one authorization request in flight while the confirmation waits", async () => {
  await using stack = new AsyncDisposableStack();
  const pending = Promise.withResolvers<boolean>();
  const confirmGrant = vi.fn(() => pending.promise);
  const { service, bridge, requests, credentials } = await setup(
    stack,
    {},
    { confirmGrant },
  );

  const first = bridge.runPromise(service.authorize);
  await vi.waitFor(() => expect(confirmGrant).toHaveBeenCalledOnce());
  expect(credentials.writes).toEqual([]);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(true);
  const second = bridge.runPromise(service.authorize);
  pending.resolve(true);

  expect(await first).toEqual({ value: undefined });
  expect(await second).toEqual({ value: undefined });
  expect(confirmGrant).toHaveBeenCalledOnce();
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
  expect(credentials.writes).toHaveLength(1);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it.each([
  { decision: "declined", confirmed: false },
  { decision: "accepted", confirmed: true },
])(
  "restores the editing state after a $decision confirmation",
  async ({ confirmed }) => {
    await using stack = new AsyncDisposableStack();
    const credentials = await (async () => {
      await using firstSession = new AsyncDisposableStack();
      const client = await setup(
        firstSession,
        {},
        { confirmGrant: () => confirmed },
      );
      await client.bridge.runPromise(client.service.authorize);
      return client.credentials;
    })();

    const confirmGrant = vi.fn(() => true);
    const { service, bridge, requests } = await setup(
      stack,
      {},
      { credentials, confirmGrant },
    );
    await bridge.runPromise(service.probe);

    expect(capabilityInput(service, bridge).authorized).toBe(confirmed);
    expect(await bridge.runPromise(service.remembered)).toBe(confirmed);
    expect(confirmGrant).not.toHaveBeenCalled();
    expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/"]);
  },
);

it("asks to confirm an earlier saved grant once, without a Zotero dialog", async () => {
  await using stack = new AsyncDisposableStack();
  const confirmGrant = vi.fn(() => true);
  const { service, bridge, requests, credentials } = await setup(
    stack,
    {},
    {
      key: "XmplApiKey0000000000000000000001",
      unconfirmed: true,
      confirmGrant,
    },
  );
  await bridge.runPromise(service.probe);
  expect(capabilityInput(service, bridge).authorized).toBe(false);

  const grant = await bridge.runPromise(service.authorize);
  const again = await bridge.runPromise(service.authorize);

  expect(grant).toEqual({ value: undefined });
  expect(again).toEqual({ value: undefined });
  expect(confirmGrant).toHaveBeenCalledOnce();
  expect(credentials.writes).toEqual([
    { serverID: SERVER_ID, key: "XmplApiKey0000000000000000000001" },
  ]);
  expect(capabilityInput(service, bridge).authorized).toBe(true);
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toEqual([]);
});

it("keeps editing off and the earlier key unused when the researcher declines it", async () => {
  await using stack = new AsyncDisposableStack();
  const confirmGrant = vi.fn(() => false);
  const { service, bridge, requests, credentials } = await setup(
    stack,
    {},
    {
      key: "XmplApiKey0000000000000000000001",
      unconfirmed: true,
      confirmGrant,
    },
  );

  const grant = await bridge.runPromise(service.authorize);
  const sent = requests.length;
  const write = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, { library: PERSONAL, method: "PATCH" }),
  );

  expect(grant).toEqual({ failure: { kind: "not-confirmed" } });
  expect(credentials.writes).toEqual([]);
  expect(credentials.record).toEqual({
    serverID: SERVER_ID,
    key: "XmplApiKey0000000000000000000001",
    unconfirmed: true,
  });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(write).toEqual({ failure: { kind: "unauthorized" } });
  expect(requests.slice(sent)).toEqual([]);
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toEqual([]);
});

it("asks no second confirmation for a grant confirmed when it was saved", async () => {
  await using stack = new AsyncDisposableStack();
  const confirmGrant = vi.fn(() => true);
  const { service, bridge, credentials } = await setup(
    stack,
    {},
    { confirmGrant },
  );

  await bridge.runPromise(service.authorize);
  await bridge.runPromise(service.probe);
  const again = await bridge.runPromise(service.authorize);

  expect(again).toEqual({ value: undefined });
  expect(confirmGrant).toHaveBeenCalledOnce();
  expect(await credentials.holdsUnconfirmed(SERVER_ID)).toBe(false);
});

it("takes Deny as a refusal, and asks again only on the next gesture", async () => {
  await using stack = new AsyncDisposableStack();
  const confirmGrant = vi.fn(() => true);
  const { requests, credentials, service, bridge } = await setup(
    stack,
    { authorize: () => denied() },
    { confirmGrant },
  );

  const refused = await bridge.runPromise(service.authorize);

  expect(refused).toEqual({ failure: { kind: "denied" } });
  expect(confirmGrant).not.toHaveBeenCalled();
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(credentials.writes).toEqual([]);
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
});

it("holds Zotero's cooldown, with the Retry-After it named", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => rateLimited(),
  });

  const limited = await bridge.runPromise(service.authorize);
  const again = await bridge.runPromise(service.authorize);

  expect(limited).toEqual({
    failure: {
      kind: "cooldown",
      retryAfter: Duration.seconds(60),
    },
  });
  expect(bridge.runSync(service.writeStateFor(null)).cooldownUntil).toEqual(
    DateTime.makeUnsafe("2026-09-16T15:53:21Z"),
  );
  expect(again).toEqual({
    failure: {
      kind: "cooldown",
      retryAfter: Duration.seconds(60),
    },
  });
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
});

it("asks again once the cooldown has run out", async () => {
  await using stack = new AsyncDisposableStack();
  const answers: ZoteroAnswers = {
    authorize: vi
      .fn()
      .mockImplementationOnce(() => rateLimited())
      .mockImplementation(() => authorized({ remember: true })),
  };
  const { runtime, service, bridge } = await setup(stack, answers);

  await bridge.runPromise(service.authorize);
  await runtime.runPromise(TestClock.adjust("61 seconds"));
  const granted = await bridge.runPromise(service.authorize);

  expect(granted).toEqual({ value: undefined });
  expect(bridge.runSync(service.writeStateFor(null)).cooldownUntil).toBeNull();
});

it("reads the local API being off from the probe the gesture runs", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    root: localApiDisabled,
  });

  const refused = await bridge.runPromise(service.authorize);

  expect(refused).toEqual({ failure: { kind: "local-api-disabled" } });
  expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/"]);
});

it("marks one library read-only for the session, and stops sending to it", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
    write: () => libraryReadOnly(),
  });
  await bridge.runPromise(service.authorize);

  const refused = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );
  const again = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(refused).toEqual({ failure: { kind: "library-read-only" } });
  expect(again).toEqual({ failure: { kind: "library-read-only" } });
  expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(1);
  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5")).libraryReadOnly,
  ).toBe(true);
  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5g12345")).libraryReadOnly,
  ).toBe(false);
});

it("lets the next Capability Probe retire a read-only library, and says so", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: true }),
    write: () => libraryReadOnly(),
  });
  const retired = vi.fn();
  stack.defer(bridge.subscribe(service.writeRefusalsRetired, retired));
  await bridge.runPromise(service.authorize);
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5")).libraryReadOnly,
  ).toBe(true);
  expect(retired).not.toHaveBeenCalled();

  await bridge.runPromise(service.probe);

  expect(
    bridge.runSync(service.writeStateFor("PUPR5FG5")).libraryReadOnly,
  ).toBe(false);
  expect(retired).toHaveBeenCalledOnce();

  await bridge.runPromise(service.probe);
  expect(retired).toHaveBeenCalledOnce();
});

it("announces a swapped Zotero database from the probe that adopts it", async () => {
  await using stack = new AsyncDisposableStack();
  let serverID = SERVER_ID;
  const { service, bridge } = await setup(stack, {
    root: () => rootOk({ "Zotero-Server-ID": serverID }),
    authorize: () => authorized({ remember: true }),
    write: () => serverChanged(OTHER_SERVER_ID),
  });
  const changes: string[] = [];
  stack.defer(
    bridge.subscribe(service.serverChanges, (id) => changes.push(id)),
  );

  await bridge.runPromise(service.probe);
  expect(changes).toEqual([]);

  await bridge.runPromise(service.authorize);
  serverID = OTHER_SERVER_ID;
  const announced = new Promise<string>((resolve) => {
    const off = bridge.subscribe(service.serverChanges, (id) => {
      off();
      resolve(id);
    });
  });
  await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(await announced).toBe(OTHER_SERVER_ID);
  await bridge.runPromise(service.probe);
  expect(changes).toEqual([OTHER_SERVER_ID]);
});

it("invalidates the record keyless when Zotero rejects the key", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, credentials } = await setup(
    stack,
    { write: () => keyRejected() },
    { key: "XmplApiKey0000000000000000000001" },
  );
  await bridge.runPromise(service.probe);

  const refused = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(refused).toEqual({ failure: { kind: "unauthorized" } });
  expect(credentials.writes).toEqual([{ serverID: SERVER_ID }]);
  expect(credentials.record).toEqual({ serverID: SERVER_ID });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(await bridge.runPromise(service.remembered)).toBe(false);
});

it("serves two presses of Allow editing with one request", async () => {
  await using stack = new AsyncDisposableStack();
  const pending = Promise.withResolvers<Response>();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => pending.promise,
  });

  const view = bridge.runPromise(service.authorize);
  const settings = bridge.runPromise(service.authorize);
  await atTheDialog(requests);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(true);
  pending.resolve(authorized({ remember: true }));

  expect(await view).toEqual({ value: undefined });
  expect(await settings).toEqual({ value: undefined });
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(1);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it("starts a new request for a press after the last one settled", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => authorized({ remember: false }),
  });

  const first = await bridge.runPromise(service.authorize);
  const second = await bridge.runPromise(service.authorize);

  expect(first).toEqual({ failure: { kind: "not-remembered" } });
  expect(second).toEqual({ failure: { kind: "not-remembered" } });
  expect(
    requests.filter(({ url }) => url.pathname === "/api/local/authorize"),
  ).toHaveLength(2);
});

it("clears the slot of a request that finishes without suspending", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, zoteroPref } = await setup(stack);
  zoteroPref.httpPort = null;
  let changes = 0;
  stack.defer(
    bridge.subscribe(service.capabilityChanges, () => (changes += 1)),
  );

  const first = await bridge.runPromise(service.authorize);
  const second = await bridge.runPromise(service.authorize);

  expect(first).toEqual({ failure: { kind: "unreachable" } });
  expect(second).toEqual({ failure: { kind: "unreachable" } });
  await vi.waitFor(() => expect(changes).toBe(5));
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it("says a request is in flight only while Zotero's dialog waits", async () => {
  await using stack = new AsyncDisposableStack();
  const pending = Promise.withResolvers<Response>();
  const { requests, service, bridge } = await setup(stack, {
    authorize: () => pending.promise,
  });
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);

  const gesture = bridge.runPromise(service.authorize);
  await atTheDialog(requests);
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(true);

  pending.resolve(denied());
  await gesture;
  expect(bridge.runSync(service.writeStateFor(null)).authorizing).toBe(false);
});

it("answers a write with no session without reaching Zotero", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(stack, {
    root: unreachable,
  });
  await bridge.runPromise(service.probe);

  const refused = await bridge.runPromise(
    service.authorizedSend(ITEM_PATH, {
      library: PERSONAL,
      method: "PATCH",
    }),
  );

  expect(refused).toEqual({ failure: { kind: "unreachable" } });
  expect(requests.filter(({ method }) => method === "PATCH")).toHaveLength(0);
});

it("drops the Remembered Authorization when the settings row forgets it", async () => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge, credentials } = await setup(
    stack,
    {},
    {
      key: "XmplApiKey0000000000000000000001",
    },
  );
  await bridge.runPromise(service.probe);

  expect(capabilityInput(service, bridge).authorized).toBe(true);
  await bridge.runPromise(service.forgetAuthorization);

  expect(credentials.record).toEqual({ serverID: SERVER_ID });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(await bridge.runPromise(service.remembered)).toBe(false);
});

it("disables editing when a remembered grant was removed outside ZotLit", async () => {
  await using stack = new AsyncDisposableStack();
  const { credentials, requests, service, bridge } = await setup(
    stack,
    {},
    { key: "XmplApiKey0000000000000000000001" },
  );
  await bridge.runPromise(service.probe);
  await credentials.forget();
  const sent = requests.length;
  expect(
    await bridge.runPromise(
      service.authorizedSend(ITEM_PATH, {
        library: PERSONAL,
        method: "PATCH",
      }),
    ),
  ).toEqual({ failure: { kind: "unauthorized" } });
  expect(capabilityInput(service, bridge).authorized).toBe(false);
  expect(requests.slice(sent)).toEqual([]);
});

function atTheDialog(requests: readonly { url: URL }[]): Promise<void> {
  return vi.waitFor(() => {
    const asked = requests.some(
      ({ url }) => url.pathname === "/api/local/authorize",
    );
    if (!asked) throw new Error("No authorization request yet");
  });
}

function capabilityInput(
  service: ZoteroLocalApi["Service"],
  bridge: EffectBridge,
) {
  const state = bridge.runSync(service.state);
  return { authorized: state.kind === "available" && state.authorized };
}

async function setup(
  stack: AsyncDisposableStack,
  answers: ZoteroAnswers = {},
  options: ClientOptions = {},
) {
  const harness = await localApiClient(answers, options);
  stack.use(harness.disposable);
  return harness;
}
