#!/usr/bin/env node
import type { RiskChange } from "#record-risk";

import { affectedBase } from "#affected-base";
import {
  CONTRACT_EXEMPTIONS,
  CONTRACT_VERSIONS,
  contractChanges,
  contractListProblems,
  repositoryContractSources,
  scanContractVersions,
} from "#contract-versions";
import { getWorkspaceRoot } from "#package-roots";
import { readLandRecord, riskLine, riskVerdict } from "#record-risk";

const root = await getWorkspaceRoot(import.meta.dirname);

const { unlisted, stale } = contractListProblems(
  scanContractVersions(await repositoryContractSources(root)),
  CONTRACT_VERSIONS,
  CONTRACT_EXEMPTIONS,
);
if (unlisted.length > 0 || stale.length > 0) {
  console.error(
    [
      ...(unlisted.length > 0
        ? [
            "These look like contract versions, and packages/scripts/lib/contract-versions.ts does not list them:",
            ...unlisted.map(({ file, key }) => `  ${file}: ${key}`),
            "Add each to CONTRACT_VERSIONS, or to CONTRACT_EXEMPTIONS with the reason that users do not read it.",
          ]
        : []),
      ...(stale.length > 0
        ? [
            "packages/scripts/lib/contract-versions.ts lists these, and the source no longer has them:",
            ...stale.map(({ file, key }) => `  ${file}: ${key}`),
            "Correct the path of each, or remove it from its list.",
          ]
        : []),
    ].join("\n"),
  );
  process.exit(1);
}

const base = await affectedBase(root);
if (!base) {
  console.log(
    "record-risk: no merge base with origin/main, so no version to compare.",
  );
  process.exit(0);
}

const changes: RiskChange[] = await contractChanges(root, base);
const verdict = riskVerdict({ changes, ...(await readLandRecord(root)) });
for (const line of verdict.lines) {
  (verdict.ok ? console.log : console.error)(line);
}
if (!verdict.ok) process.exit(1);
console.log(
  `record-risk: ${CONTRACT_VERSIONS.length} contract versions compared with ${base.slice(0, 12)}${
    changes.length > 0
      ? `; changed: ${changes.map(riskLine).join("; ")}`
      : ", none changed"
  }.`,
);
