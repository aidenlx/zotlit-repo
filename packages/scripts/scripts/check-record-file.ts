#!/usr/bin/env node
import { landRecordDiagnostic } from "#land";
import { getWorkspaceRoot } from "#package-roots";
import { readLandRecord } from "#record-risk";

const root = await getWorkspaceRoot(import.meta.dirname);
const { record, path, required } = await readLandRecord(root);
if (record === undefined) {
  console.log(`record-file: no record file yet at ${path}.`);
  process.exit(0);
}
const diagnostic = landRecordDiagnostic(record, { squash: !required });
if (diagnostic) {
  console.error(diagnostic);
  process.exit(1);
}
console.log(`record-file: ${path} has the title and the sections of a land.`);
