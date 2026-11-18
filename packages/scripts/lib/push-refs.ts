// What the pre-push hook lets through. `next` and `main` take pushes only from
// `pnpm land`, which pushes during its Land Turn; an agent session pushes
// nothing of its own, since `land` pushes for it. A person pushes any other
// branch freely: the quality gate runs in `land`, on the rebased result.

/**
 * One ref line that Git hands a pre-push hook on stdin:
 * `<local ref> <local sha> <remote ref> <remote sha>`.
 */
export interface PushRef {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export function parsePushRefs(input: string): PushRef[] {
  return input
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [localRef = "", localSha = "", remoteRef = "", remoteSha = ""] =
        line.split(" ");
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/** The branches that only `land` pushes. */
const LANDED_REFS = new Set(["refs/heads/next", "refs/heads/main"]);

/**
 * Why the push may not go ahead; empty when it may.
 * @param context.agent the push runs in an agent session.
 * @param context.land the push comes from a land that holds its Land Turn.
 */
export function pushProblems(
  refs: readonly PushRef[],
  context: { agent: boolean; land: boolean },
): string[] {
  if (context.land || refs.length === 0) return [];
  if (context.agent) {
    return [
      `An agent session pushes nothing itself (${refs.map((ref) => ref.remoteRef).join(", ")}). Land the branch with pnpm land: it rebases onto next, runs the gate, and pushes.`,
    ];
  }
  return refs
    .filter((ref) => LANDED_REFS.has(ref.remoteRef))
    .map(
      (ref) =>
        `${ref.remoteRef.slice("refs/heads/".length)} takes pushes only from pnpm land (pnpm land --to main for main).`,
    );
}
