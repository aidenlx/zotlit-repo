// When one case breaks the run vault, every later case of its file would wait
// on its own CLI deadline and fail: one broken popout cost a Query View file
// 27 failures and 15 minutes. The guard ends a file at the first case after
// which the vault stops answering, and names that case as the cause.

import { afterEach, beforeEach } from "vitest";

import { expectNothingLeftOpen } from "./case-leftovers.ts";
import { cli } from "./obsidian-cli.ts";

/** Short next to the CLI deadline: a live window answers `1` in milliseconds. */
const PROBE_TIMEOUT_MS = 5_000;

/** What a per-case hook reads of Vitest's context. */
interface GuardedCase {
  task: {
    fullName: string;
    file: { filepath: string };
    result?: { state?: string; errors?: readonly unknown[] };
  };
}

/** The first case of each file after which the run vault stopped answering. */
const stoppedFiles = new Map<string, { caseName: string; failure: string }>();

/**
 * One error as indented lines: `name: message`, then the inner errors that a
 * report would hide. A `SuppressedError` from `await using` carries the case's
 * own failure in `suppressed` and the disposal's in `error`. The shape is the
 * same for a thrown error and for Vitest's serialized copy of it.
 */
function describeError(error: unknown, indent = ""): string {
  if (typeof error !== "object" || error === null)
    return `${indent}${String(error)}`;
  const { name, message, suppressed, cause } = error as Record<string, unknown>;
  const head = [name, message]
    .filter((part) => typeof part === "string" && part !== "")
    .join(": ");
  const lines = [
    `${indent}${(head || JSON.stringify(error)).replaceAll("\n", `\n${indent}  `)}`,
  ];
  const inner = `${indent}  `;
  if (name === "SuppressedError") {
    lines.push(`${inner}suppressed (the case's own failure):`);
    lines.push(describeError(suppressed, `${inner}  `));
    lines.push(`${inner}disposal error:`);
    lines.push(
      describeError((error as { error?: unknown }).error, `${inner}  `),
    );
  }
  if (cause !== undefined) {
    lines.push(`${inner}cause:`);
    lines.push(describeError(cause, `${inner}  `));
  }
  return lines.join("\n");
}

/**
 * The per-case hooks of a file that runs in one Obsidian vault.
 *
 * After a case fails, or its leftovers check fails, one short call asks the
 * vault whether it still answers. When it gets no answer, every later case of
 * the same file fails before it starts, with the first failed case's name and
 * errors in its message. Cases of other files still run.
 *
 * @param leftovers run {@link expectNothingLeftOpen} after each case
 */
export function createRunVaultGuard(
  vaultId: () => string,
  { leftovers = true }: { leftovers?: boolean } = {},
): {
  before: (context: GuardedCase) => void;
  after: (context: GuardedCase) => Promise<void>;
} {
  return {
    before({ task }) {
      const stopped = stoppedFiles.get(task.file.filepath);
      if (!stopped) return;
      throw new Error(
        `Not run: the run vault stopped answering after "${stopped.caseName}" failed, so the remaining cases of this file fail at once.\n\nFirst failure:\n${stopped.failure}`,
      );
    },
    async after({ task }) {
      if (stoppedFiles.has(task.file.filepath)) return;
      let leftover: Error | undefined;
      if (leftovers) {
        try {
          await expectNothingLeftOpen(vaultId());
        } catch (error) {
          leftover = error instanceof Error ? error : new Error(String(error));
        }
      }
      const caseErrors = task.result?.errors ?? [];
      if (task.result?.state !== "fail" && leftover === undefined) return;
      const probe = await cli(
        [`vault=${vaultId()}`, "eval", "code=1"],
        PROBE_TIMEOUT_MS,
      ).then(
        () => undefined,
        (error: unknown) => error ?? new Error("no answer"),
      );
      if (probe === undefined) {
        if (leftover !== undefined) throw leftover;
        return;
      }
      const failure = [
        ...caseErrors,
        ...(leftover === undefined ? [] : [leftover]),
      ]
        .map((error) => `- ${describeError(error, "  ").slice(2)}`)
        .join("\n");
      stoppedFiles.set(task.file.filepath, {
        caseName: task.fullName,
        failure,
      });
      throw new Error(
        `The run vault stopped answering after this case, so the remaining cases of this file fail at once.\n\nThis case's failure:\n${failure}`,
        { cause: probe },
      );
    },
  };
}

/** Register {@link createRunVaultGuard}'s hooks in the current suite. */
export function registerRunVaultGuard(
  ...args: Parameters<typeof createRunVaultGuard>
): void {
  const guard = createRunVaultGuard(...args);
  beforeEach(guard.before);
  afterEach(guard.after);
}
