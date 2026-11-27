const OWNER_KEYS = [
  "CLAUDE_JOB_DIR",
  "CLAUDE_CODE_SESSION_ID",
  "CODEX_THREAD_ID",
] as const;

export const CREATION_WINDOW_MS = 120_000;

export type OwnerMark = Partial<Record<(typeof OWNER_KEYS)[number], string>>;

export function ownerMark(env: NodeJS.ProcessEnv): OwnerMark | undefined {
  const mark: OwnerMark = {};
  for (const key of OWNER_KEYS) if (env[key]) mark[key] = env[key];
  return Object.keys(mark).length > 0 ? mark : undefined;
}

export function isNewWorktree(bornMs: number, nowMs: number): boolean {
  return bornMs > 0 && nowMs - bornMs < CREATION_WINDOW_MS;
}

export function isOwner(mark: unknown, env: NodeJS.ProcessEnv): boolean {
  if (typeof mark !== "object" || mark === null) return false;
  const named = mark as Record<string, unknown>;
  if (env.CODEX_THREAD_ID) return named.CODEX_THREAD_ID === env.CODEX_THREAD_ID;
  return (["CLAUDE_JOB_DIR", "CLAUDE_CODE_SESSION_ID"] as const).some(
    (key) => Boolean(env[key]) && named[key] === env[key],
  );
}

export function refusal(path: string, branch: string): string {
  const quoted = `'${path.replaceAll("'", "'\\''")}'`;
  return (
    `Could not verify that this session created the worktree at ${quoted}` +
    `${branch ? ` (branch ${branch})` : ""}. ` +
    "Report this path to the person. Do not remove it another way."
  );
}
