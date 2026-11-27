import { zipSync } from "fflate";
import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as v from "valibot";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import type { DocsLine } from "./shared.ts";
import { baseURL, zotlitBetaUrl } from "./shared.ts";

const AGENT_SKILLS_SCHEMA =
  "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const SKILL_NAMES = [
  "zotlit-template",
  "zotlit-pandoc",
  "zotlit-citations",
  "zotlit-query",
] as const;
type AgentSkillName = (typeof SKILL_NAMES)[number];

const AGENT_SKILLS_ROUTE = "/.well-known/agent-skills";

const skillMetadata = v.object({
  name: v.string(),
  description: v.string(),
});

const ARCHIVE_LOCAL_MTIME = "2000-01-01T00:00:00";

interface AgentSkillFiles {
  skill: Uint8Array;
  openAiMetadata: Uint8Array;
}

function resolvePinnedCommitSha(workspaceRoot: string): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;

  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();
}

function createArchive({
  skill,
  openAiMetadata,
}: AgentSkillFiles): Uint8Array<ArrayBuffer> {
  return zipSync(
    {
      "SKILL.md": skill,
      "agents/openai.yaml": openAiMetadata,
    },
    { level: 9, mtime: ARCHIVE_LOCAL_MTIME },
  );
}

function digest(content: Uint8Array): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function archiveUrl(name: AgentSkillName, commitSha: string): string {
  return `${AGENT_SKILLS_ROUTE}/${name}/${commitSha}/archive.zip`;
}

export async function agentSkillAssets(
  packageRoot: string,
  docsLine: DocsLine,
): Promise<Map<string, Uint8Array>> {
  const workspaceRoot = await getWorkspaceRoot(packageRoot);
  const commitSha = resolvePinnedCommitSha(workspaceRoot);
  const assetBaseURL = docsLine === "beta" ? zotlitBetaUrl : baseURL;

  const built = await Promise.all(
    SKILL_NAMES.map(async (directoryName) => {
      const [skill, openAiMetadata] = await Promise.all([
        readFile(join(workspaceRoot, `skills/${directoryName}/SKILL.md`)),
        readFile(
          join(workspaceRoot, `skills/${directoryName}/agents/openai.yaml`),
        ),
      ]);
      const archive = createArchive({ skill, openAiMetadata });
      const { name, description } = v.parse(
        skillMetadata,
        frontmatter(skill.toString("utf8")).data,
      );
      if (name !== directoryName) {
        throw new Error(
          `SKILL.md frontmatter name must match its '${directoryName}' directory.`,
        );
      }
      return { directoryName, description, archive };
    }),
  );

  const index = `${JSON.stringify(
    {
      $schema: AGENT_SKILLS_SCHEMA,
      skills: built.map(({ directoryName, description, archive }) => ({
        name: directoryName,
        type: "archive",
        description,
        url: `${assetBaseURL}${archiveUrl(directoryName, commitSha)}`,
        digest: digest(archive),
      })),
    },
    null,
    2,
  )}\n`;

  return new Map<string, Uint8Array>([
    [`${AGENT_SKILLS_ROUTE}/index.json`, new TextEncoder().encode(index)],
    ...built.map(({ directoryName, archive }): [string, Uint8Array] => [
      archiveUrl(directoryName, commitSha),
      archive,
    ]),
  ]);
}
