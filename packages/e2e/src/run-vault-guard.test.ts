import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const socketBoundary = vi.hoisted(() => ({
  calls: 0,
  answer: (_code: string): Promise<string> =>
    Promise.resolve('=> {"value":[]}'),
}));
vi.mock("node:net", () => ({
  createConnection() {
    const socket = new EventEmitter();
    Object.assign(socket, {
      setNoDelay() {},
      destroy(error: Error) {
        socket.emit("error", error);
      },
      write(request: string) {
        socketBoundary.calls++;
        const { argv } = JSON.parse(request) as { argv: string[] };
        const code = argv.find((arg) => arg.startsWith("code="))!.slice(5);
        void socketBoundary.answer(code).then((reply) => {
          socket.emit("data", Buffer.from(reply));
          socket.emit("end");
        });
      },
    });
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  },
}));

import type * as ObsidianCli from "./obsidian-cli.ts";
import type * as RunVaultGuard from "./run-vault-guard.ts";

let obRun: typeof ObsidianCli.obRun;
let obRunUntil: typeof ObsidianCli.obRunUntil;
let createRunVaultGuard: typeof RunVaultGuard.createRunVaultGuard;
beforeEach(async () => {
  vi.resetModules();
  ({ obRun, obRunUntil } = await import("./obsidian-cli.ts"));
  ({ createRunVaultGuard } = await import("./run-vault-guard.ts"));
});

const FILE = "/suite/query-view.e2e.ts";

const live = (): Promise<string> => Promise.resolve('=> {"value":[]}');
const dead = (): Promise<string> => new Promise<string>(() => {});

beforeEach(() => {
  vi.useFakeTimers();
  socketBoundary.calls = 0;
  socketBoundary.answer = live;
});

afterEach(() => {
  vi.useRealTimers();
});

function caseContext(
  filepath: string,
  fullName: string,
  errors?: unknown[],
): Parameters<ReturnType<typeof createRunVaultGuard>["after"]>[0] {
  return {
    task: {
      fullName,
      file: { filepath },
      result: errors ? { state: "fail", errors } : { state: "pass" },
    },
  };
}

async function disposalSuppressed(): Promise<unknown> {
  try {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => {
      throw new Error("layout restore got no answer");
    });
    throw new Error("Filter popover did not open");
  } catch (error) {
    return error;
  }
}

async function settled(hook: Promise<void>): Promise<unknown> {
  const outcome = hook.then(
    () => undefined,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  return outcome;
}

it("fails the remaining cases of the file at once, naming the first failed case and its inner errors", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = FILE;
  socketBoundary.answer = dead;
  const first = await settled(
    guard.after(
      caseContext(file, "Query View > draws past the edge in the popout", [
        await disposalSuppressed(),
      ]),
    ),
  );
  expect(String(first)).toContain("run vault stopped answering");
  expect(String(first)).toContain("Filter popover did not open");
  expect(String(first)).toContain("layout restore got no answer");

  const callsAfterBreak = socketBoundary.calls;
  const later = caseContext(file, "Query View > the next case");
  expect(() => guard.before(later)).toThrow(
    /"Query View > draws past the edge in the popout"[\s\S]*Filter popover did not open[\s\S]*layout restore got no answer/,
  );
  await guard.after(later);
  expect(socketBoundary.calls).toBe(callsAfterBreak);
});

it("names the leftovers check when it is the only failure of the case", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = FILE;
  socketBoundary.answer = dead;
  expect(
    String(await settled(guard.after(caseContext(file, "passing case")))),
  ).toContain("run vault stopped answering");
  expect(() => guard.before(caseContext(file, "next case"))).toThrow(
    /"passing case"[\s\S]*did not answer/,
  );
});

it("still runs the cases of another file", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  socketBoundary.answer = dead;
  await settled(guard.after(caseContext(FILE, "breaks", [new Error("x")])));
  socketBoundary.answer = live;
  const other = caseContext("/suite/b.e2e.ts", "runs");
  expect(() => guard.before(other)).not.toThrow();
  const calls = socketBoundary.calls;
  await guard.after(other);
  expect(socketBoundary.calls).toBeGreaterThan(calls);
});

it("keeps a case's own failure when the vault still answers", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = FILE;
  await guard.after(caseContext(file, "fails", [new Error("assertion")]));
  expect(() => guard.before(caseContext(file, "next case"))).not.toThrow();
});

it("reports a stalled leftovers check without failing the file when the vault answers again", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = FILE;
  let stalls = 1;
  socketBoundary.answer = () => (stalls-- > 0 ? dead() : live());
  const outcome = await settled(guard.after(caseContext(file, "stalls once")));
  expect(outcome).toMatchObject({
    message: "The leftovers check got no reply",
    cause: { name: "ObsidianUnreachableError" },
  });
  expect(String(outcome)).not.toContain("run vault stopped answering");
  expect(() => guard.before(caseContext(file, "next case"))).not.toThrow();
});

it("asks a vault without a leftovers check only after a failed case", async () => {
  const guard = createRunVaultGuard(() => "run-vault", { leftovers: false });
  const file = FILE;
  socketBoundary.answer = dead;
  await guard.after(caseContext(file, "passes"));
  expect(socketBoundary.calls).toBe(0);
  expect(
    String(
      await settled(
        guard.after(caseContext(file, "fails", [new Error("step failed")])),
      ),
    ),
  ).toContain("run vault stopped answering");
  expect(() => guard.before(caseContext(file, "next step"))).toThrow(
    /"fails"[\s\S]*step failed/,
  );
});

it("refuses at once a hook's call to the stopped vault from the same file", async () => {
  const guard = createRunVaultGuard(() => "hook-vault");
  const thisFile = expect.getState().testPath!;
  socketBoundary.answer = dead;
  await settled(
    guard.after(caseContext(thisFile, "breaks", [new Error("popout lost")])),
  );
  socketBoundary.answer = live;
  const calls = socketBoundary.calls;
  await expect(obRun("hook-vault", () => true)).rejects.toThrow(
    /Not run[\s\S]*"breaks"[\s\S]*popout lost/,
  );
  await expect(
    obRunUntil("hook-vault", () => true, undefined, { what: "ready" }),
  ).rejects.toThrow(/Not run/);
  expect(socketBoundary.calls).toBe(calls);
  await expect(obRun("other-vault", () => true)).resolves.toEqual([]);
});
