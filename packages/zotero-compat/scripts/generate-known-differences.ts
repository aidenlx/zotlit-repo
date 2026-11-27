import type { KnownDifference } from "#known-differences.ts";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { KNOWN_DIFFERENCES } from "#known-differences.ts";

const guidePath = join(resolve(import.meta.dirname, ".."), "AGENTS.md");
const START = "<!-- known-differences:start -->";
const END = "<!-- known-differences:end -->";

const guide = await readFile(guidePath, "utf8");
const start = guide.indexOf(START);
const end = guide.indexOf(END);
if (start === -1 || end < start) {
  throw new Error(`AGENTS.md has no ${START} … ${END} section`);
}
await writeFile(
  guidePath,
  `${guide.slice(0, start + START.length)}\n\n${renderTable()}\n\n${guide.slice(end)}`,
);

function cell(value: string): string {
  return value.replaceAll("|", "\\|");
}

function json(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    const members = Object.entries(value).map(
      ([key, member]) => `${key}: ${json(member)}`,
    );
    return `{ ${members.join(", ")} }`;
  }
  return JSON.stringify(value).replaceAll(
    /[^\x20-\x7e]/gu,
    (char) => `\\u{${char.codePointAt(0)!.toString(16).toUpperCase()}}`,
  );
}

function code(value: string): string {
  return cell(`\`${value}\``);
}

function owner({ port, importer }: KnownDifference): string {
  return importer === undefined
    ? code(port)
    : `importer (${code(importer)}), with ${code(port)}`;
}

function call({ port, args }: KnownDifference): string {
  return code(`${port}(${args.map(json).join(", ")})`);
}

function client({ client }: KnownDifference): string {
  return typeof client === "object" && client !== null
    ? cell(client.outcome)
    : code(json(client));
}

function renderTable(): string {
  return [
    "| Function | Call | Client result | This package | Accepted by | Reason |",
    "| --- | --- | --- | --- | --- | --- |",
    ...KNOWN_DIFFERENCES.map(
      (row) =>
        `| ${owner(row)} | ${call(row)} | ${client(row)} | ${code(json(row.result))} | ${cell(row.acceptedBy)} | ${cell(row.reason)} |`,
    ),
  ].join("\n");
}
