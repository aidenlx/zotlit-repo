import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The run vault's CLI socket: each call either answers as a live window with
// nothing left open, or never answers, as a window whose renderer is gone.
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

import { obRun, obRunUntil } from "./obsidian-cli.ts";
import { createRunVaultGuard } from "./run-vault-guard.ts";

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

/** A case's hook context as Vitest passes it, after the case body ran. */
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

/** The error an `await using` stack throws when its disposal fails after the body failed. */
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

/** Settle `hook` while the clock runs past every CLI deadline. */
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
  const file = "/suite/query-view.e2e.ts";
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
  // No clock advance: the case fails without waiting on any deadline.
  expect(() => guard.before(later)).toThrow(
    /"Query View > draws past the edge in the popout"[\s\S]*Filter popover did not open[\s\S]*layout restore got no answer/,
  );
  await guard.after(later);
  expect(socketBoundary.calls).toBe(callsAfterBreak);
});

it("names the leftovers check when it is the only failure of the case", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = "/suite/library-view.e2e.ts";
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
  await settled(
    guard.after(caseContext("/suite/a.e2e.ts", "breaks", [new Error("x")])),
  );
  socketBoundary.answer = live;
  const other = caseContext("/suite/b.e2e.ts", "runs");
  expect(() => guard.before(other)).not.toThrow();
  const calls = socketBoundary.calls;
  await guard.after(other);
  expect(socketBoundary.calls).toBeGreaterThan(calls);
});

it("keeps a case's own failure when the vault still answers", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = "/suite/annotations.e2e.ts";
  await guard.after(caseContext(file, "fails", [new Error("assertion")]));
  expect(() => guard.before(caseContext(file, "next case"))).not.toThrow();
});

it("reports a stalled leftovers check without failing the file when the vault answers again", async () => {
  const guard = createRunVaultGuard(() => "run-vault");
  const file = "/suite/query-file.e2e.ts";
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
  const guard = createRunVaultGuard(() => "own-vault", { leftovers: false });
  const file = "/suite/walkthrough.e2e.ts";
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
  // The hooks of this test file call the vault, as a file's own afterEach does.
  const thisFile = expect.getState().testPath!;
  socketBoundary.answer = dead;
  await settled(
    guard.after(caseContext(thisFile, "breaks", [new Error("popout lost")])),
  );
  socketBoundary.answer = live;
  const calls = socketBoundary.calls;
  // No clock advance: neither the call nor the poll waits on a deadline.
  await expect(obRun("hook-vault", () => true)).rejects.toThrow(
    /Not run[\s\S]*"breaks"[\s\S]*popout lost/,
  );
  await expect(
    obRunUntil("hook-vault", () => true, undefined, { what: "ready" }),
  ).rejects.toThrow(/Not run/);
  expect(socketBoundary.calls).toBe(calls);
  // Another vault from the same file still answers.
  await expect(obRun("other-vault", () => true)).resolves.toEqual([]);
});
