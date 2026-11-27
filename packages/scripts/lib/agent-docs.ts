import { posix } from "node:path";

const NAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CODING_STANDARDS.md",
  "CONTRIBUTING.md",
  "GLOSSARY.md",
  "GLOSSARY-MAP.md",
  "README.md",
]);

export function isAgentDoc(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  if (NAMES.has(posix.basename(path))) return true;
  return (
    path.startsWith("policies/") ||
    path.includes("/policies/") ||
    path.startsWith("docs/") ||
    path.startsWith(".agents/") ||
    path.startsWith(".claude/")
  );
}

export function isAgentDocsOnly(changed: readonly string[]): boolean {
  return changed.length > 0 && changed.every((path) => isAgentDoc(path));
}

export async function verifyAgentDocs(run: {
  step: (
    name: "Generated artifacts" | "Agent guides",
    check: () => Promise<unknown>,
  ) => Promise<void>;
  generated: () => Promise<unknown>;
  guides: () => Promise<unknown>;
}): Promise<void> {
  await run.step("Generated artifacts", run.generated);
  await run.step("Agent guides", run.guides);
}
