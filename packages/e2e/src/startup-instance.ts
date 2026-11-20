import { spawn } from "node:child_process";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { userInfo } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { evaluate, openCdpSession } from "@zotlit/scripts/obsidian-cdp";
import type { CdpSession } from "@zotlit/scripts/obsidian-cdp";

import type { ProbeResult } from "./startup-probe.ts";

export const OBSIDIAN_BINARY =
  "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const ENDPOINT_TIMEOUT_MS = 30_000;
const QUIT_TIMEOUT_MS = 30_000;
const RESULT_TIMEOUT_MS = 120_000;

export interface InstanceLayout {
  readonly root: string;
  readonly home: string;
  readonly userData: string;
  readonly vaultPath: string;
  readonly vaultId: string;
  readonly resultDir: string;
}

export function instanceLayout(root: string, vaultId: string): InstanceLayout {
  return {
    root,
    home: join(root, "home"),
    userData: join(root, "user-data"),
    vaultPath: join(root, "vault"),
    vaultId,
    resultDir: join(root, "results"),
  };
}

export function ownerSocket(): string {
  return join(userInfo().homedir, ".obsidian-cli.sock");
}

export async function socketIdentity(
  path: string,
): Promise<string | undefined> {
  const found = await stat(path).catch(() => undefined);
  return found ? `${found.dev}:${found.ino}` : undefined;
}

export async function writeRegistry(layout: InstanceLayout): Promise<void> {
  await mkdir(layout.home, { recursive: true });
  await mkdir(layout.userData, { recursive: true });
  await mkdir(layout.resultDir, { recursive: true });
  await writeFile(
    join(layout.userData, "obsidian.json"),
    JSON.stringify({
      vaults: {
        [layout.vaultId]: {
          path: layout.vaultPath,
          ts: Temporal.Now.instant().epochMilliseconds,
          open: true,
        },
      },
      updateDisabled: true,
    }),
  );
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export interface Instance extends AsyncDisposable {
  readonly pid: number;
  readonly exited: Promise<void>;
  devtools(): Promise<CdpSession>;
  nextResult(): Promise<ProbeResult>;
  next(action: "quit" | "reload"): Promise<void>;
  quit(): Promise<void>;
}

export async function launchInstance(
  layout: InstanceLayout,
  {
    devtools = false,
    log,
  }: { devtools?: boolean; log: (message: string) => void },
): Promise<Instance> {
  await writeRegistry(layout);
  const before = await socketIdentity(ownerSocket());
  const port = devtools ? await freePort() : undefined;
  const output = await open(join(layout.root, "obsidian.log"), "a");
  const seen = new Set(await readdir(layout.resultDir));
  const child = spawn(
    OBSIDIAN_BINARY,
    [
      `--user-data-dir=${layout.userData}`,
      "--use-mock-keychain",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      ...(port === undefined ? [] : [`--remote-debugging-port=${port}`]),
    ],
    {
      env: { ...process.env, HOME: layout.home },
      stdio: ["ignore", output.fd, output.fd],
    },
  );
  const pid = child.pid!;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  void exited.then(() => output.close().catch(() => undefined));
  const alive = () => child.exitCode === null && child.signalCode === null;

  const quit = async (): Promise<void> => {
    if (!alive()) return;
    process.kill(pid, "SIGTERM");
    const done = await Promise.race([
      exited.then(() => true),
      delay(QUIT_TIMEOUT_MS).then(() => false),
    ]);
    if (!done) {
      log(
        `Obsidian pid ${pid} did not quit within ${QUIT_TIMEOUT_MS} ms; killing it`,
      );
      process.kill(pid, "SIGKILL");
      await exited;
    }
  };

  await delay(1000);
  if ((await socketIdentity(ownerSocket())) !== before) {
    await quit();
    throw new Error(
      `the owner's CLI socket ${ownerSocket()} changed after the launch of pid ${pid}`,
    );
  }

  return {
    pid,
    exited,
    async devtools() {
      if (port === undefined) throw new Error("launched without devtools");
      const deadline = performance.now() + ENDPOINT_TIMEOUT_MS;
      while (performance.now() < deadline) {
        const list = await fetch(`http://127.0.0.1:${port}/json/list`)
          .then(
            (reply) =>
              reply.json() as Promise<
                { type: string; url: string; webSocketDebuggerUrl: string }[]
              >,
          )
          .catch(() => []);
        const page = list.find(
          (target) =>
            target.type === "page" && target.url.endsWith("/index.html"),
        );
        if (page) return openCdpSession(page.webSocketDebuggerUrl);
        await delay(100);
      }
      throw new Error("the vault window answered no CDP");
    },
    async nextResult() {
      const deadline = performance.now() + RESULT_TIMEOUT_MS;
      while (performance.now() < deadline) {
        if (!alive())
          throw new Error(
            `Obsidian pid ${pid} exited before the probe reported`,
          );
        for (const name of await readdir(layout.resultDir)) {
          if (
            !name.startsWith("result-") ||
            !name.endsWith(".json") ||
            seen.has(name)
          )
            continue;
          seen.add(name);
          return JSON.parse(
            await readFile(join(layout.resultDir, name), "utf8"),
          ) as ProbeResult;
        }
        await delay(100);
      }
      throw new Error(
        `the probe in pid ${pid} reported nothing within ${RESULT_TIMEOUT_MS} ms`,
      );
    },
    async next(action) {
      await writeFile(join(layout.resultDir, "next"), action);
      if (action === "quit") {
        const done = await Promise.race([
          exited.then(() => true),
          delay(QUIT_TIMEOUT_MS).then(() => false),
        ]);
        if (!done) await quit();
      }
    },
    quit,
    async [Symbol.asyncDispose]() {
      await quit();
      await rm(join(layout.resultDir, "next"), { force: true });
    },
  };
}

export async function cdpEval<T>(
  session: CdpSession,
  expression: string,
): Promise<T> {
  const outcome = await evaluate(session, expression);
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.value as T;
}
