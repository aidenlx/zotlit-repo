import { createConnection } from "node:net";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

export const OBSIDIAN_CALL_TIMEOUT_MS = 30_000;

function targetVault(args: string[]): string | undefined {
  return args.find((arg) => arg.startsWith("vault="))?.slice("vault=".length);
}

function timeoutLabel(timeoutMs: number): string {
  return timeoutMs % 1_000 === 0
    ? `${timeoutMs / 1_000} seconds`
    : `${timeoutMs} milliseconds`;
}

export class ObsidianUnreachableError extends Error {
  readonly vault: string | undefined;

  constructor(args: string[], timeoutMs: number) {
    const vault = targetVault(args);
    super(
      `${vault ? `Obsidian vault ${vault}` : "The focused Obsidian vault window"} did not answer within ${timeoutLabel(timeoutMs)}.\n\n` +
        "Known causes: the evaluated code awaits a promise that never settles\n" +
        "(requestAnimationFrame in a hidden window, for example — the obsidian-debug\n" +
        'skill\'s "Hidden window" section turns its throttling off); the window\n' +
        "reloaded during the call; or the window's renderer crashed while the\n" +
        "vault registry still reports it open, so every call to it waits forever.\n\n" +
        "Restart Obsidian if a quick call to the same vault, such as\n" +
        "`obsidian-cli.ts --code 1`, also gets no answer, then rerun the command.",
    );
    this.name = "ObsidianUnreachableError";
    this.vault = vault;
  }
}

export function isObsidianUnreachable(
  error: unknown,
): error is ObsidianUnreachableError {
  return error instanceof ObsidianUnreachableError;
}

interface BoundedCallConfig {
  timeoutMs?: number;
}

interface CallOptions {
  signal?: AbortSignal;
}

export function createBoundedObsidianCall(
  run: (args: string[], signal: AbortSignal) => Promise<string>,
  { timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS }: BoundedCallConfig = {},
): (args: string[], options?: CallOptions) => Promise<string> {
  return async (args, { signal }: CallOptions = {}) => {
    const controller = new AbortController();
    const abortCall = (): void => controller.abort();
    signal?.addEventListener("abort", abortCall);
    const expiry = Promise.withResolvers<never>();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
      expiry.reject(new ObsidianUnreachableError(args, timeoutMs));
    }, timeoutMs);
    const call = run(args, controller.signal);
    call.catch(() => undefined);
    try {
      return await Promise.race([call, expiry.promise]);
    } catch (error) {
      throw expired ? new ObsidianUnreachableError(args, timeoutMs) : error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortCall);
    }
  };
}

export function obsidianCliSocketPath(): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\obsidian-cli-${userInfo().username}`;
  }
  const base =
    (process.platform !== "darwin" && process.env.XDG_RUNTIME_DIR) || homedir();
  return join(base, ".obsidian-cli.sock");
}

function requestLine(argv: string[]): string {
  const json = JSON.stringify({ argv, tty: false, cwd: process.cwd() });
  return `${json.replaceAll(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  )}\n`;
}

export function createObsidianCall({
  socketPath = obsidianCliSocketPath(),
  timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS,
}: { socketPath?: string; timeoutMs?: number } = {}): (
  args: string[],
  options?: CallOptions,
) => Promise<string> {
  return createBoundedObsidianCall(
    (args, signal) =>
      new Promise<string>((resolve, reject) => {
        const socket = createConnection(socketPath);
        const chunks: Buffer[] = [];
        signal.addEventListener(
          "abort",
          () => socket.destroy(new Error("Obsidian CLI call aborted")),
          { once: true },
        );
        socket.setNoDelay(true);
        socket.on("connect", () => socket.write(requestLine(args)));
        socket.on("data", (chunk: Buffer) => chunks.push(chunk));
        socket.on("end", () =>
          resolve(Buffer.concat(chunks).toString("utf8").trim()),
        );
        socket.on("error", reject);
        socket.on("close", () =>
          reject(
            new Error("Obsidian closed the CLI connection without a reply"),
          ),
        );
      }),
    { timeoutMs },
  );
}
