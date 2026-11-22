import { SOURCE_BRANCH } from "@zotlit/config/repositories";

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

const LANDED_REF = `refs/heads/${SOURCE_BRANCH}`;

export function pushProblems(
  refs: readonly PushRef[],
  context: { agent: boolean; land: boolean },
): string[] {
  if (context.land || refs.length === 0) return [];
  if (context.agent) {
    return [
      `An agent session pushes nothing itself (${refs.map((ref) => ref.remoteRef).join(", ")}). Land the branch with pnpm land: it rebases onto ${SOURCE_BRANCH}, runs the gate, and pushes.`,
    ];
  }
  return refs
    .filter((ref) => ref.remoteRef === LANDED_REF)
    .map(() => `${SOURCE_BRANCH} takes pushes only from pnpm land.`);
}
