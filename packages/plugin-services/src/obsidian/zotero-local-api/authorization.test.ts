import { DateTime, Duration } from "effect";
import { TestClock } from "effect/testing";
import { expect, it, vi } from "vitest";

import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

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
import type { ClientOptions, ZoteroAnswers } from "./__fixtures__.ts";
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
  const { service, bridge, requests, credentials } = await setup(stack, {
    authorize: () => authorized({ remember: false }),
    write: () => writeAccepted(),
  });

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
    key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
  });
  expect(credentials.read).toHaveBeenCalledTimes(3);
  expect(
    requests
      .filter(({ method }) => method === "PATCH")
      .map(({ headers }) => headers.get("zotero-api-key")),
  ).toEqual([
    "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
    "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
  ]);
});

it("raises no second dialog once an authorization is remembered", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, service, bridge } = await setup(
    stack,
    { authorize: () => authorized({ remember: true }) },
    { key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf" },
  );

  const grant = await bridge.runPromise(service.authorize);

  expect(grant).toEqual({ value: undefined });
  expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/"]);
});

it.each<[string, () => Response]>([
  ["Always Allow", () => authorized({ remember: true })],
  [
    "a dismissed dialog",
    () =>
      authorized({ remember: true, key: "4zQONVs9iqR87qvc4istHwfQ3oUp1Ygi" }),
  ],
])("reads %s as a grant", async (_outcome, answer) => {
  await using stack = new AsyncDisposableStack();
  const { service, bridge } = await setup(stack, { authorize: answer });

  const grant = await bridge.runPromise(service.authorize);

  expect(grant).toEqual({ value: undefined });
  expect(capabilityInput(service, bridge).authorized).toBe(true);
});

it("takes Deny as a refusal, and asks again only on the next gesture", async () => {
  await using stack = new AsyncDisposableStack();
  const { requests, credentials, service, bridge } = await setup(stack, {
    authorize: () => denied(),
  });

  const refused = await bridge.runPromise(service.authorize);

  expect(refused).toEqual({ failure: { kind: "denied" } });
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
    { key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf" },
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
      key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf",
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
    { key: "5ixBzUhQfLu8i8RIhU6OEzENW4pAITLf" },
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
