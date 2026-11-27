import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { git, makeGitRepos } from "./__fixtures__/git-repos.ts";
import type { GitRepos } from "./__fixtures__/git-repos.ts";
import {
  CONTRACT_EXEMPTIONS,
  CONTRACT_VERSIONS,
  contractChanges,
  contractListProblems,
  readContractVersion,
  repositoryContractSources,
  scanContractVersions,
} from "./contract-versions.ts";
import type { ContractVersion } from "./contract-versions.ts";
import { getWorkspaceRoot } from "./package-roots.ts";

const SLOW = 20_000;

describe("scanContractVersions", () => {
  it("finds each constant and JSON key that looks like a contract version", () => {
    const found = scanContractVersions([
      {
        path: "a/envelope.ts",
        text: "export const CONTRACT_VERSION = 4;\nconst SCHEMA_VERSION = 2;",
      },
      { path: "b/cli-image.ts", text: "const contractVersion = 2;" },
      { path: "c/version.ts", text: "export const PROTOCOL_VERSION = 9;" },
      { path: "d/wire.ts", text: 'export const API_VERSION = "3";' },
      { path: "e/contract-version.json", text: '{ "contractVersion": 3 }' },
      {
        path: "f/answer.ts",
        text: "const answer = { contractVersion: 3 };\nexport const CONTRACT_VERSION = other.contractVersion;",
      },
      {
        path: "h/as-const.ts",
        text: "export const WIRE_VERSION = 5 as const;",
      },
      { path: "g/data.json", text: '{ "items": [{ "contractVersion": 1 }] }' },
    ]);
    expect(found).toEqual([
      { file: "a/envelope.ts", key: "CONTRACT_VERSION" },
      { file: "b/cli-image.ts", key: "contractVersion" },
      { file: "c/version.ts", key: "PROTOCOL_VERSION" },
      { file: "d/wire.ts", key: "API_VERSION" },
      { file: "e/contract-version.json", key: "contractVersion" },
      { file: "f/answer.ts", key: "CONTRACT_VERSION" },
      { file: "h/as-const.ts", key: "WIRE_VERSION" },
    ]);
  });

  it("names each found version that the lists leave out, and each listed version that is not found", () => {
    const registry: ContractVersion[] = [
      { name: "A", file: "a/envelope.ts", key: "CONTRACT_VERSION" },
    ];
    expect(
      contractListProblems(
        [
          { file: "a/envelope.ts", key: "CONTRACT_VERSION" },
          { file: "b/cli-image.ts", key: "contractVersion" },
        ],
        registry,
        [
          {
            file: "e/sample.json",
            key: "contractVersion",
            reason: "a sample that a change removed",
          },
        ],
      ),
    ).toEqual({
      unlisted: [{ file: "b/cli-image.ts", key: "contractVersion" }],
      stale: [{ file: "e/sample.json", key: "contractVersion" }],
    });
  });
});

describe("readContractVersion", () => {
  it("reads a TypeScript constant and a JSON key", () => {
    expect(
      readContractVersion(
        { name: "A", file: "a.ts", key: "contractVersion" },
        "const contractVersion = 2;",
      ),
    ).toBe(2);
    expect(
      readContractVersion(
        { name: "B", file: "b.json", key: "contractVersion" },
        '{ "contractVersion": 3 }',
      ),
    ).toBe(3);
    expect(
      readContractVersion(
        { name: "C", file: "c.ts", key: "CONTRACT_VERSION" },
        "export const OTHER = 1;",
      ),
    ).toBeNull();
  });
});

describe("the contract versions of this repository", () => {
  it("lists each contract version of the source in the registry or the exemptions", async () => {
    const root = await getWorkspaceRoot(import.meta.dirname);
    const found = scanContractVersions(await repositoryContractSources(root));
    expect(
      contractListProblems(found, CONTRACT_VERSIONS, CONTRACT_EXEMPTIONS),
    ).toEqual({ unlisted: [], stale: [] });
  });
});

describe("contractChanges", () => {
  let repos: GitRepos;
  let cwd: string;
  const registry: ContractVersion[] = [
    { name: "Citations CLI", file: "src/envelope.ts", key: "CONTRACT_VERSION" },
    {
      name: "Query CLI",
      file: "src/contract-version.json",
      key: "contractVersion",
    },
  ];
  const write = async (file: string, text: string) => {
    await mkdir(dirname(join(cwd, file)), { recursive: true });
    await writeFile(join(cwd, file), text);
  };

  beforeEach(async () => {
    repos = await makeGitRepos();
    cwd = await repos.clone("work");
  });
  afterEach(async () => {
    await repos.dispose();
  });

  it(
    "names each registered version that differs from the merge base, and skips a contract that the base does not have",
    async () => {
      await write("src/envelope.ts", "export const CONTRACT_VERSION = 4;\n");
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "base");
      const base = await git(cwd, "rev-parse", "HEAD");
      expect(await contractChanges(cwd, base, registry.slice(0, 1))).toEqual(
        [],
      );

      await write("src/envelope.ts", "export const CONTRACT_VERSION = 5;\n");
      await write("src/contract-version.json", '{ "contractVersion": 1 }\n');
      expect(await contractChanges(cwd, base, registry)).toEqual([
        { subject: "Contract Citations CLI", old: "4", new: "5" },
      ]);
    },
    SLOW,
  );

  it(
    "follows a contract to its former path at the base, as for the move of the Item Query CLI version",
    async () => {
      const former = "src/desktop/item-query/contract-version.json";
      const moved = "src/worker/item-query/contract-version.json";
      await write(former, '{ "contractVersion": 3 }\n');
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "base");
      const base = await git(cwd, "rev-parse", "HEAD");
      await git(cwd, "rm", "-q", former);
      await write(moved, '{ "contractVersion": 4 }\n');
      expect(
        await contractChanges(cwd, base, [
          {
            name: "Item Query CLI",
            file: moved,
            key: "contractVersion",
            formerPaths: [former],
          },
        ]),
      ).toEqual([{ subject: "Contract Item Query CLI", old: "3", new: "4" }]);
    },
    SLOW,
  );

  it(
    "reads a version that moved into a file that existed at the base without it",
    async () => {
      await write("src/old.ts", "export const CONTRACT_VERSION = 3;\n");
      await write("src/new.ts", "export const OTHER = 1;\n");
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "base");
      const base = await git(cwd, "rev-parse", "HEAD");
      await git(cwd, "rm", "-q", "src/old.ts");
      await write(
        "src/new.ts",
        "export const OTHER = 1;\nexport const CONTRACT_VERSION = 4;\n",
      );
      expect(
        await contractChanges(cwd, base, [
          {
            name: "Citations CLI",
            file: "src/new.ts",
            key: "CONTRACT_VERSION",
            formerPaths: ["src/old.ts"],
          },
        ]),
      ).toEqual([{ subject: "Contract Citations CLI", old: "3", new: "4" }]);
    },
    SLOW,
  );

  it(
    "reads the second former path when the first is not at the base",
    async () => {
      await write("src/old.ts", "export const CONTRACT_VERSION = 3;\n");
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "base");
      const base = await git(cwd, "rev-parse", "HEAD");
      await git(cwd, "rm", "-q", "src/old.ts");
      await write("src/new.ts", "export const CONTRACT_VERSION = 4;\n");
      expect(
        await contractChanges(cwd, base, [
          {
            name: "Citations CLI",
            file: "src/new.ts",
            key: "CONTRACT_VERSION",
            formerPaths: ["src/older.ts", "src/old.ts"],
          },
        ]),
      ).toEqual([{ subject: "Contract Citations CLI", old: "3", new: "4" }]);
    },
    SLOW,
  );

  it(
    "fails when a former path of a moved contract is not at the base",
    async () => {
      const former = "src/desktop/item-query/contract-version.json";
      const moved = "src/worker/item-query/contract-version.json";
      await write(former, '{ "contractVersion": 3 }\n');
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "base");
      const base = await git(cwd, "rev-parse", "HEAD");
      await git(cwd, "rm", "-q", former);
      await write(moved, '{ "contractVersion": 4 }\n');
      await expect(
        contractChanges(cwd, base, [
          {
            name: "Item Query CLI",
            file: moved,
            key: "contractVersion",
            formerPaths: ["src/desktop/item-qeury/contract-version.json"],
          },
        ]),
      ).rejects.toThrow(
        "contract Item Query CLI has no contractVersion at the base",
      );
    },
    SLOW,
  );

  it(
    "rejects the scan, with the path, when a tracked source cannot be read",
    async () => {
      const source = "packages/p/src/contract.ts";
      await write(source, "export const CONTRACT_VERSION = 1;\n");
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "source");
      await unlink(join(cwd, source));
      await mkdir(join(cwd, source));
      await expect(repositoryContractSources(cwd)).rejects.toThrow(
        `${source} cannot be read`,
      );
    },
    SLOW,
  );

  it(
    "fails when a registered version cannot be read on the branch",
    async () => {
      await write("src/envelope.ts", "export const CONTRACT_VERSION = 4;\n");
      await git(cwd, "add", ".");
      await git(cwd, "commit", "-q", "-m", "base");
      const base = await git(cwd, "rev-parse", "HEAD");
      await write("src/envelope.ts", "export const VERSION = 4;\n");
      await expect(contractChanges(cwd, base, registry)).rejects.toThrow(
        "src/envelope.ts",
      );
    },
    SLOW,
  );
});
