import { setTimeout as delay } from "node:timers/promises";

import { createObsidianCall } from "@zotlit/scripts/obsidian-cli";

import type { ObsidianContext, JsonCompatible } from "./page-context.ts";
import { createPageHelpers } from "./page-helpers.ts";
import { createReaderHandle } from "./reader-handle.ts";

const CLI_TIMEOUT_MS = 15_000;

const boundedCall = createObsidianCall({ timeoutMs: CLI_TIMEOUT_MS });

export class RunVaultStoppedError extends Error {
  override name = "RunVaultStoppedError";
}

let refusal: (vaultId: string) => RunVaultStoppedError | undefined = () =>
  undefined;

export function refuseRunVaultCalls(check: typeof refusal): void {
  refusal = check;
}

export function cli(args: string[], timeoutMs?: number): Promise<string> {
  const vault = args.find((arg) => arg.startsWith("vault="));
  const refused = vault && refusal(vault.slice("vault=".length));
  if (refused) return Promise.reject(refused);
  const call =
    timeoutMs === undefined ? boundedCall : createObsidianCall({ timeoutMs });
  return call(args);
}

const THROWN = "__zotlitEvalError__";

function wrapEvalCode(code: string): string {
  return `(async()=>{try{return await (0,eval)(${JSON.stringify(code)});}catch(error){return ${JSON.stringify(THROWN)}+JSON.stringify({message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined});}})()`;
}

function thrownError(json: string): Error {
  const { message, stack } = JSON.parse(json) as {
    message: string;
    stack?: string;
  };
  const frames = stack
    ?.split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
  return new Error(frames ? `${message}\n${frames}` : message);
}

function parseEvalReply(text: string): string {
  const marker = "\n=> ";
  const lastIndex = text.lastIndexOf(marker);
  let reply: string;
  if (lastIndex !== -1) reply = text.slice(lastIndex + marker.length);
  else if (text.startsWith("=> ")) reply = text.slice(3);
  else throw new Error(`obsidian reply had no "=> " line: ${text}`);
  if (reply.startsWith(THROWN)) throw thrownError(reply.slice(THROWN.length));
  return reply;
}

async function obEval(
  vaultId: string,
  code: string,
  timeoutMs?: number,
): Promise<string> {
  const text = await cli(
    [`vault=${vaultId}`, "eval", `code=${wrapEvalCode(code)}`],
    timeoutMs,
  );
  if (text === "") return "";
  return parseEvalReply(text);
}

export async function clearNotices(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page }) => {
    for (const doc of page.windowDocuments())
      for (const node of doc.querySelectorAll(".notice")) node.remove();
  });
}

export async function cliCommand(
  vaultId: string,
  command: string,
  options: {
    args?: Readonly<Record<string, string>>;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  return cli(
    [
      `vault=${vaultId}`,
      command,
      ...Object.entries(options.args ?? {}).map(
        ([name, value]) => `${name}=${value}`,
      ),
    ],
    options.timeoutMs,
  );
}

export async function waitFor(
  check: () => Promise<boolean>,
  tries = 40,
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (await check()) return true;
    await delay(250);
  }
  return false;
}

export async function readUntil<T>(
  read: () => Promise<T | null>,
  ready: (value: T) => boolean,
  { what, tries = 40 }: { what: string; tries?: number },
): Promise<T> {
  let value: T | null = null;
  const settled = await waitFor(async () => {
    value = await read();
    return value !== null && ready(value);
  }, tries);
  if (!settled) throw new Error(`${what}: ${JSON.stringify(value)}`);
  return value!;
}

// oxlint-disable-next-line max-params -- The approved callback API keeps options fourth.
export async function obRun<A = undefined, R = void>(
  vaultId: string,
  callback: (
    context: ObsidianContext,
    args: A,
  ) => (R & JsonCompatible<R>) | Promise<R & JsonCompatible<R>>,
  args?: A & JsonCompatible<A>,
  options: { timeoutMs?: number } = {},
): Promise<Awaited<R>> {
  const code = `(async()=>{const page=globalThis.__zotlitPageHelpers;if(!page)return '__zotlitHelpersMissing__';const result=await (${callback.toString()})({app,zotlit:{get services(){return app.plugins.plugins.zotlit.services;}},reader:{get services(){return app.plugins.plugins["zotlit-reader"].services;},get api(){return app.plugins.plugins["zotlit-reader"].api;}},page},${JSON.stringify(args) ?? "undefined"});return JSON.stringify({value:result});})()`;
  let reply = await obEval(vaultId, code, options.timeoutMs);
  if (reply === "__zotlitHelpersMissing__") {
    await obEval(
      vaultId,
      `globalThis.__zotlitPageHelpers=(${createPageHelpers.toString()})(app,${createReaderHandle.toString()});true`,
      options.timeoutMs,
    );
    reply = await obEval(vaultId, code, options.timeoutMs);
  }
  return (JSON.parse(reply) as { value: Awaited<R> }).value;
}

// oxlint-disable-next-line max-params -- The approved callback API keeps options fourth.
export async function obRunUntil<A = undefined, R = boolean>(
  vaultId: string,
  callback: (
    context: ObsidianContext,
    args: A,
  ) => (R & JsonCompatible<R>) | Promise<R & JsonCompatible<R>>,
  args: (A & JsonCompatible<A>) | undefined,
  {
    ready = (value) => value === true,
    what,
    tries = 40,
  }: { ready?: (value: Awaited<R>) => boolean; what: string; tries?: number },
): Promise<Awaited<R>> {
  let last: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      // oxlint-disable-next-line zotlit-tests/no-eval-capture -- Forward the caller-checked callback through the transport.
      const value = await obRun(vaultId, callback, args);
      last = value;
      if (ready(value)) return value;
    } catch (error) {
      if (error instanceof RunVaultStoppedError) throw error;
      last = error instanceof Error ? error.message : String(error);
    }
    await delay(250);
  }
  throw new Error(`${what}: ${JSON.stringify(last)}`);
}
