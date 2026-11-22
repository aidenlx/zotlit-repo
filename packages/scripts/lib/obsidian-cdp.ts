import {
  createObsidianCall,
  OBSIDIAN_CALL_TIMEOUT_MS,
} from "./obsidian-cli.ts";

export const DEFAULT_CDP_PORT = 9222;
export const DEFAULT_MAIN_INSPECTOR_PORT = 9229;

const IDENTIFY_TIMEOUT_MS = 3_000;
const CONNECT_TIMEOUT_MS = 5_000;
const OBJECT_GROUP = "zotlit-obsidian-cdp";

const IDENTIFY_WINDOW = `(() => {
  const host = window.opener ?? window;
  const app = host.app;
  return { vault: typeof app === "object" && app ? app.appId ?? null : null, child: !!window.opener };
})()`;

export function launchCommand(port: number): string {
  const flag = `--remote-debugging-port=${port}`;
  if (process.platform === "darwin") return `open -a Obsidian --args ${flag}`;
  if (process.platform === "win32") {
    return `"%LOCALAPPDATA%\\Programs\\Obsidian\\Obsidian.exe" ${flag}`;
  }
  return `obsidian ${flag}`;
}

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  devtoolsFrontendUrl: string;
}

export interface ObsidianWindow {
  id: string;
  vault: string | null;
  kind: "main" | "child" | "silent";
  title: string;
  webSocketDebuggerUrl: string;
  devtoolsUrl: string;
}

interface SendOptions {
  timeoutMs?: number;
  sessionId?: string;
}

interface CdpEvent {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CdpSession extends Disposable {
  onEvent(listener: (event: CdpEvent) => void): Disposable;
  send(
    method: string,
    params?: Record<string, unknown>,
    options?: SendOptions,
  ): Promise<Record<string, unknown>>;
}

function unreachable(port: number, cause: unknown): Error {
  return new Error(
    `No Obsidian CDP endpoint answered on 127.0.0.1:${port}.\n\n` +
      `Obsidian enables CDP only at launch. Quit Obsidian, then start it with:\n` +
      `  ${launchCommand(port)}`,
    { cause },
  );
}

async function listTargets(port: number): Promise<CdpTarget[]> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
  } catch (error) {
    throw unreachable(port, error);
  }
  if (!response.ok) {
    throw unreachable(port, new Error(`HTTP ${response.status}`));
  }
  return (await response.json()) as CdpTarget[];
}

export async function openCdpSession(wsUrl: string): Promise<CdpSession> {
  const socket = new WebSocket(wsUrl);
  const pending = new Map<
    number,
    { resolve(result: Record<string, unknown>): void; reject(e: Error): void }
  >();
  const listeners = new Set<(event: CdpEvent) => void>();
  let nextId = 0;
  const failAll = (reason: string): void => {
    for (const call of pending.values()) call.reject(new Error(reason));
    pending.clear();
  };
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      sessionId?: string;
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (message.id === undefined && message.method) {
      for (const listener of listeners)
        listener({ ...message, method: message.method });
      return;
    }
    const call = message.id === undefined ? undefined : pending.get(message.id);
    if (!call) return;
    pending.delete(message.id!);
    if (message.error) call.reject(new Error(`CDP: ${message.error.message}`));
    else call.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () =>
    failAll("The window closed or reloaded before it answered"),
  );

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP connect to ${wsUrl} timed out`));
    }, CONNECT_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CDP connect to ${wsUrl} failed`));
    });
  });

  return {
    onEvent(listener) {
      listeners.add(listener);
      return {
        [Symbol.dispose]: () => {
          listeners.delete(listener);
        },
      };
    },
    send(
      method,
      params = {},
      { timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS, sessionId } = {},
    ) {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new Error("The window closed or reloaded before it answered"),
        );
      }
      const id = ++nextId;
      const reply = Promise.withResolvers<Record<string, unknown>>();
      const timer = setTimeout(() => {
        pending.delete(id);
        reply.reject(
          new Error(`CDP ${method} got no answer within ${timeoutMs} ms`),
        );
      }, timeoutMs);
      pending.set(id, {
        resolve: reply.resolve,
        reject: reply.reject,
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
      return reply.promise.finally(() => clearTimeout(timer));
    },
    [Symbol.dispose]() {
      listeners.clear();
      socket.close();
    },
  };
}

export async function listObsidianWindows(
  port = DEFAULT_CDP_PORT,
): Promise<ObsidianWindow[]> {
  const pages = (await listTargets(port)).filter((t) => t.type === "page");
  return Promise.all(
    pages.map(async (target): Promise<ObsidianWindow> => {
      let identity: { vault: string | null; child: boolean } | undefined;
      try {
        using session = await openCdpSession(target.webSocketDebuggerUrl);
        const reply = await session.send(
          "Runtime.evaluate",
          { expression: IDENTIFY_WINDOW, returnByValue: true },
          { timeoutMs: IDENTIFY_TIMEOUT_MS },
        );
        identity = (reply.result as { value?: typeof identity }).value;
      } catch {
        // A crashed or busy renderer; list it so the caller sees it.
      }
      return {
        id: target.id,
        vault: identity?.vault ?? null,
        kind: identity ? (identity.child ? "child" : "main") : "silent",
        title: target.title,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl,
        devtoolsUrl: `http://127.0.0.1:${port}${target.devtoolsFrontendUrl}`,
      };
    }),
  );
}

export function formatWindow(w: ObsidianWindow): string {
  return `${w.id}  ${w.kind}  ${w.vault ?? "-"}  ${w.title}`;
}

export function selectWindow(
  windows: ObsidianWindow[],
  { vault, target }: { vault?: string; target?: string },
): ObsidianWindow {
  const describe = (): string =>
    windows.map((w) => `  ${formatWindow(w)}`).join("\n") || "  none";
  let matches: ObsidianWindow[];
  if (target) {
    matches = windows.filter((w) => w.id.startsWith(target.toUpperCase()));
  } else {
    matches = windows.filter(
      (w) => w.kind === "main" && (!vault || w.vault === vault),
    );
  }
  if (matches.length === 1) return matches[0]!;
  const wanted = target
    ? `target ${target}`
    : vault
      ? `the main window of vault ${vault}`
      : "a single main window (pass --vault or --target)";
  throw new Error(
    `${matches.length === 0 ? "No" : "More than one"} window matches ${wanted}.\n\nWindows:\n${describe()}`,
  );
}

type RemoteObject = {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  objectId?: string;
};

type EvalReply = {
  result: RemoteObject;
  exceptionDetails?: { text: string; exception?: RemoteObject };
};

export type EvalOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export async function evaluate(
  session: CdpSession,
  expression: string,
  { timeoutMs = OBSIDIAN_CALL_TIMEOUT_MS }: SendOptions = {},
): Promise<EvalOutcome> {
  const failed = (reply: EvalReply): EvalOutcome => ({
    ok: false,
    error:
      reply.exceptionDetails?.exception?.description ??
      reply.exceptionDetails?.text ??
      "unknown exception",
  });
  try {
    let reply = (await session.send(
      "Runtime.evaluate",
      {
        expression,
        replMode: true,
        awaitPromise: true,
        userGesture: true,
        objectGroup: OBJECT_GROUP,
      },
      { timeoutMs },
    )) as EvalReply;
    if (reply.exceptionDetails) return failed(reply);
    if (reply.result.subtype === "promise") {
      reply = (await session.send(
        "Runtime.awaitPromise",
        { promiseObjectId: reply.result.objectId },
        { timeoutMs },
      )) as EvalReply;
      if (reply.exceptionDetails) return failed(reply);
    }
    const remote = reply.result;
    if (!remote.objectId) {
      return {
        ok: true,
        value: remote.type === "undefined" ? undefined : remote.value,
      };
    }
    if (remote.type === "function" || remote.subtype === "node") {
      return { ok: true, value: remote.description };
    }
    const byValue = (await session.send(
      "Runtime.callFunctionOn",
      {
        objectId: remote.objectId,
        functionDeclaration: "function () { return this; }",
        returnByValue: true,
      },
      { timeoutMs },
    )) as EvalReply;
    return byValue.exceptionDetails
      ? { ok: true, value: remote.description }
      : { ok: true, value: byValue.result.value };
  } finally {
    await session
      .send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP })
      .catch(() => undefined);
  }
}

export interface MainInspector {
  webSocketDebuggerUrl: string;
  devtoolsUrl: string;
}

export async function openMainInspector({
  port = DEFAULT_MAIN_INSPECTOR_PORT,
  vault,
}: { port?: number; vault?: string } = {}): Promise<MainInspector> {
  const code = `(() => {
    const inspector = require("@electron/remote").require("inspector");
    if (!inspector.url()) inspector.open(${port}, "127.0.0.1");
    return inspector.url();
  })()`;
  const reply = await createObsidianCall()([
    ...(vault ? [`vault=${vault}`] : []),
    "eval",
    `code=${code}`,
  ]);
  const url = reply
    .split("\n")
    .findLast((line) => line.startsWith("=> ws://"))
    ?.slice("=> ".length);
  if (!url) {
    throw new Error(
      `Obsidian did not open its main-process inspector: ${reply}`,
    );
  }
  return {
    webSocketDebuggerUrl: url,
    devtoolsUrl: `devtools://devtools/bundled/js_app.html?v8only=true&ws=${url.slice("ws://".length)}`,
  };
}
