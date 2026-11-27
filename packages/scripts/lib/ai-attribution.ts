import { regex } from "arkregex";

const ATTRIBUTION_LINES = [
  regex("^\\s*co-authored-by:.*(claude|cursor|anthropic|copilot)"),
  regex("^\\s*claude-session:"),
  regex("generated with .*(claude|cursor)"),
  regex("^\\s*made with cursor"),
  regex("noreply@anthropic\\.com|cursoragent@cursor\\.com"),
];

const AGENT_IDENTITIES = [
  regex("noreply@anthropic\\.com|cursoragent@cursor\\.com"),
  regex("^(claude|cursor agent)( |$)"),
];

const AGENT_BRANCH = regex("^refs/heads/(claude|codex|cursor)/");

export function attributionLines(message: string): string[] {
  return message
    .split("\n")
    .filter((line) =>
      ATTRIBUTION_LINES.some((re) => re.test(line.toLowerCase())),
    );
}

export function isAgentIdentity(name: string, email: string): boolean {
  return AGENT_IDENTITIES.some(
    (re) => re.test(name.toLowerCase()) || re.test(email.toLowerCase()),
  );
}

export function isAgentBranch(ref: string): boolean {
  return AGENT_BRANCH.test(ref);
}

export const AGENT_ENV = [
  "AI_AGENT",
  "CLAUDE_CODE",
  "CLAUDECODE",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
] as const;

export function isAgentEnvironment(env: NodeJS.ProcessEnv): boolean {
  return AGENT_ENV.some((name) => Boolean(env[name]));
}
