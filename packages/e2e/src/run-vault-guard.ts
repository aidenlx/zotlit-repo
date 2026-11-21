// When one case breaks the run vault, every later case of its file would wait
// on its own CLI deadline and fail: one broken popout cost a Query View file
// 27 failures and 15 minutes. The guard ends a file at the first case after
// which the vault stops answering, and names that case as the cause.

import { afterEach, beforeEach, expect } from "vitest";

import { leftOpen } from "./case-leftovers.ts";
import {
  cli,
  refuseRunVaultCalls,
  RunVaultStoppedError,
} from "./obsidian-cli.ts";

/** What a per-case hook reads of Vitest's context. */
interface GuardedCase {
  task: {
    fullName: string;
    file: { filepath: string };
    result?: { state?: string; errors?: readonly unknown[] };
  };
}

/**
 * The first case after which a vault stopped answering, keyed by the file
 * and the vault: one file's stop leaves other files' calls alone.
 */
const stops = new Map<string, { caseName: string; failure: string }>();

const stopKey = (file: string, vaultId: string): string =>
  `${file}\0${vaultId}`;

function stoppedError(
  file: string,
  vaultId: string,
): RunVaultStoppedError | undefined {
  const stop = stops.get(stopKey(file, vaultId));
  if (!stop) return undefined;
  return new RunVaultStoppedError(
    `Not run: the run vault stopped answering after "${stop.caseName}" failed, so the rest of this file fails at once.\n\nFirst failure:\n${stop.failure}`,
  );
}

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

/** Whether the vault answers `1` within the suite's CLI deadline. */
async function answers(vaultId: string): Promise<boolean> {
  try {
    await cli([`vault=${vaultId}`, "eval", "code=1"]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The per-case hooks of a file that runs in one Obsidian vault.
 *
 * A reply to the leftovers check shows that the vault answers. When that
 * check gets no reply, or a case fails with no leftovers check, one more call
 * asks the vault for `1`. When that call gets no answer, the file stops for
 * that vault: each later case fails in its `beforeEach`, and each later CLI
 * call of the file to that vault, its own hooks' included, fails at once.
 * The message names the first failed case and its errors. Other files still
 * reach the vault.
 */
export function createRunVaultGuard(
  vaultId: () => string,
  {
    leftovers = true,
  }: {
    /**
     * Check after each case for menus, dialogs and popovers left open.
     * @default true
     */
    leftovers?: boolean;
  } = {},
): {
  before: (context: GuardedCase) => void;
  after: (context: GuardedCase) => Promise<void>;
} {
  refuseRunVaultCalls((vault) =>
    stoppedError(expect.getState().testPath ?? "", vault),
  );
  return {
    before({ task }) {
      const stopped = stoppedError(task.file.filepath, vaultId());
      if (stopped) throw stopped;
    },
    async after({ task }) {
      const file = task.file.filepath;
      const vault = vaultId();
      if (stops.has(stopKey(file, vault))) return;
      const noReply: unknown[] = [];
      if (leftovers) {
        const left = await leftOpen(vault).then(
          (list) => ({ answered: true as const, list }),
          (error: unknown) => ({ answered: false as const, error }),
        );
        if (left.answered) {
          expect(
            left.list,
            "menus, dialogs and popovers the case left open",
          ).toEqual([]);
          return;
        }
        noReply.push(left.error);
      } else if (task.result?.state !== "fail") return;
      if (await answers(vault)) {
        if (noReply.length > 0)
          throw new Error("The leftovers check got no reply", {
            cause: noReply[0],
          });
        return;
      }
      const failure = [...(task.result?.errors ?? []), ...noReply]
        .map((error) => `- ${describeError(error, "  ").slice(2)}`)
        .join("\n");
      stops.set(stopKey(file, vault), { caseName: task.fullName, failure });
      throw new Error(
        `The run vault stopped answering after this case, so the rest of this file fails at once.\n\nThis case's failure:\n${failure}`,
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
