import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const EXIT_REMOTE_CACHE_AUTH = 77;

export const REMOTE_CACHE_AUTH_HELP =
  "Turbo could not sign in to the Remote Cache. Stop and ask the user to run `pnpm exec turbo login` (the turbo of this repository), then run this command again.";

const AUTH_FAILURE =
  /Failed to refresh stored Vercel auth token|Remote cache returned 40[13]\b/;

export function remoteCacheAuthFailed(text: string): boolean {
  return AUTH_FAILURE.test(text);
}

export interface GateOutput {
  readonly path: string;
  readonly authFailed: () => boolean;
}

export function teeGateOutput(
  path: string,
  onAuthFailure: () => void,
): GateOutput {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
  let authFailed = false;
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (
      chunk: string | Uint8Array,
      ...rest: unknown[]
    ) => boolean;
    stream.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
      const text =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      appendFileSync(path, text);
      if (!authFailed && remoteCacheAuthFailed(text)) {
        authFailed = true;
        onAuthFailure();
      }
      return write(chunk, ...rest);
    };
  }
  return { path, authFailed: () => authFailed };
}
