import { afterEach, beforeEach, expect } from "vitest";

import { leftOpen } from "./case-leftovers.ts";
import {
  cli,
  refuseRunVaultCalls,
  RunVaultStoppedError,
} from "./obsidian-cli.ts";

interface GuardedCase {
  task: {
    fullName: string;
    file: { filepath: string };
    result?: { state?: string; errors?: readonly unknown[] };
  };
}

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

async function answers(vaultId: string): Promise<boolean> {
  try {
    await cli([`vault=${vaultId}`, "eval", "code=1"]);
    return true;
  } catch {
    return false;
  }
}

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

export function registerRunVaultGuard(
  ...args: Parameters<typeof createRunVaultGuard>
): void {
  const guard = createRunVaultGuard(...args);
  beforeEach(guard.before);
  afterEach(guard.after);
}
