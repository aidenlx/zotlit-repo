import { describe, expect, it } from "vitest";

import { isAgentDoc, isAgentDocsOnly, verifyAgentDocs } from "./agent-docs.ts";

describe("isAgentDoc", () => {
  it.each([
    "AGENTS.md",
    "apps/obsidian/AGENTS.md",
    "CLAUDE.md",
    "CODING_STANDARDS.md",
    "apps/obsidian/CODING_STANDARDS.md",
    "packages/db/GLOSSARY.md",
    "README.md",
    "CONTRIBUTING.md",
    "policies/simplicity.md",
    "apps/obsidian/policies/services.md",
    "docs/adr/0076-checks-run-before-push-and-ci-runs-only-to-release.md",
    "docs/agents/issue-tracker.md",
    ".agents/skills/obsidian-services/SKILL.md",
    ".claude/skills/codex/SKILL.md",
  ])("counts %s", (path) => {
    expect(isAgentDoc(path)).toBe(true);
  });

  it.each([
    "apps/obsidian/src/services/note-import/turndown/__snapshots__/zt-note-example.md",
    "packages/scripts/lib/fixture/vault-pages/Scan target.md",
    "apps/docs/content/docs/reference/templates/data.mdx",
    "apps/docs/content/docs/index.md",
    "pnpm-lock.yaml",
    "apps/obsidian/src/main.ts",
    ".claude/settings.json",
  ])("does not count %s", (path) => {
    expect(isAgentDoc(path)).toBe(false);
  });
});

describe("isAgentDocsOnly", () => {
  it("is true when every changed file is an agent doc", () => {
    expect(isAgentDocsOnly(["AGENTS.md", "policies/simplicity.md"])).toBe(true);
  });

  it("is false when one changed file is not", () => {
    expect(isAgentDocsOnly(["AGENTS.md", "pnpm-lock.yaml"])).toBe(false);
  });

  it("is true for a guide that holds a generated block, which keeps the fast path", () => {
    expect(isAgentDocsOnly(["packages/zotero-compat/AGENTS.md"])).toBe(true);
  });

  it("is false when nothing changed", () => {
    expect(isAgentDocsOnly([])).toBe(false);
  });
});

describe("verifyAgentDocs", () => {
  const steps: string[] = [];
  const step = async (name: string, check: () => Promise<unknown>) => {
    steps.push(name);
    await check();
  };

  it("fails the run of a docs-only branch when the guide check fails", async () => {
    steps.length = 0;
    await expect(
      verifyAgentDocs({
        step,
        generated: async () => {},
        guides: async () => {
          throw new Error("packages/db/AGENTS.md: 2,400 words");
        },
      }),
    ).rejects.toThrow("packages/db/AGENTS.md: 2,400 words");
    expect(steps).toEqual(["Generated artifacts", "Agent guides"]);
  });
});
