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
