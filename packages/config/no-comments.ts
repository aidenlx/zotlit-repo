import { createScanner } from "jsonc-parser";
import type { SyntaxKind } from "jsonc-parser";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { Input } from "postcss";
import { Parser } from "yaml";

import { SOURCE_BRANCH } from "./src/core/repositories.ts";

type Span = { start: number; end: number };
type Comment = { file: string; line: number; endLine: number; text: string };
type Baseline = Record<string, string>;

const root = resolve(import.meta.dirname, "../..");
const baselinePath = "packages/config/comment-baseline.json";
const scriptExtensions = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);
const yamlExtensions = new Set([".yaml", ".yml"]);
const jsonExtensions = new Set([".json", ".jsonc", ".jsonl"]);
const upstreamOrGenerated = [
  "apps/docs/worker-configuration.d.ts",
  "packages/filter-expression/src/generated/",
  "packages/pdf-structure/src/vendor/native-text-selection-map.js",
  "packages/pdf-structure/src/vendor/page-label.js",
  "packages/pdf-structure/src/vendor/structure.js",
  "packages/pdf-structure/src/vendor/util.js",
  "packages/pdfjs-dist/",
  "packages/pdfjs/dist/",
];
const require = createRequire(import.meta.url);
const { SyntaxKind: jsonToken } = require("jsonc-parser") as {
  SyntaxKind: Record<
    "EOF" | "LineCommentTrivia" | "BlockCommentTrivia",
    SyntaxKind
  >;
};
const tokenizeCss = require("postcss/lib/tokenize") as (input: Input) => {
  endOfFile(): boolean;
  nextToken():
    | [kind: string, text: string, start?: number, end?: number]
    | undefined;
};

function collectYamlComments(value: unknown, spans: Span[]) {
  if (!value || typeof value !== "object") return;
  if (
    "type" in value &&
    value.type === "comment" &&
    "offset" in value &&
    typeof value.offset === "number" &&
    "source" in value &&
    typeof value.source === "string"
  ) {
    spans.push({
      start: value.offset,
      end: value.offset + value.source.length,
    });
    return;
  }
  for (const child of Object.values(value)) collectYamlComments(child, spans);
}

function commentSpans(file: string, source: string): Span[] {
  const extension = extname(file);
  if (jsonExtensions.has(extension)) {
    const spans: Span[] = [];
    const scanner = createScanner(source);
    for (
      let token = scanner.scan();
      token !== jsonToken.EOF;
      token = scanner.scan()
    ) {
      if (
        token === jsonToken.LineCommentTrivia ||
        token === jsonToken.BlockCommentTrivia
      ) {
        const start = scanner.getTokenOffset();
        spans.push({ start, end: start + scanner.getTokenLength() });
      }
    }
    return spans;
  }

  if (yamlExtensions.has(extension)) {
    const spans: Span[] = [];
    for (const token of new Parser().parse(source))
      collectYamlComments(token, spans);
    return spans.sort((left, right) => left.start - right.start);
  }

  if (extension !== ".css") {
    const parsed = parseSync(file, source);
    if (parsed.errors.length > 0) {
      throw new Error(
        `${file}: ${parsed.errors.map(({ message }) => message).join("\n")}`,
      );
    }
    return parsed.comments;
  }

  const input = new Input(source, { from: file });
  const tokenizer = tokenizeCss(input);
  const bomLength = source.length - input.css.length;
  const spans: Span[] = [];
  while (!tokenizer.endOfFile()) {
    const token = tokenizer.nextToken();
    if (
      token?.[0] === "comment" &&
      token[2] !== undefined &&
      token[3] !== undefined
    ) {
      spans.push({
        start: token[2] + bomLength,
        end: token[3] + bomLength + 1,
      });
    }
  }
  return spans;
}

export function scan(file: string, source: string) {
  let code = "";
  let cursor = 0;
  let line = 1;
  const comments: Comment[] = [];
  const commentLines = new Set<number>();
  for (const { start, end } of commentSpans(file, source)) {
    const gap = source.slice(cursor, start);
    const text = source.slice(start, end);
    const lines = text.split("\n");
    line += gap.split("\n").length - 1;
    const endLine = line + lines.length - 1;
    comments.push({ file, line, endLine, text });
    for (let at = line; at <= endLine; at++) commentLines.add(at);
    code += gap + "\n".repeat(lines.length - 1);
    line = endLine;
    cursor = end;
  }
  const codeLines = (code + source.slice(cursor)).split("\n");
  return {
    comments,
    commentOnlyLines: [...commentLines].filter(
      (at) => !codeLines[at - 1]?.trim(),
    ).length,
    mixedLines: [...commentLines].filter((at) => codeLines[at - 1]?.trim())
      .length,
  };
}

function inventory() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 24 },
  ).split("\0");
  return [...new Set(files)]
    .sort()
    .filter((file) => {
      const extension = extname(file);
      return (
        (extension === ".css" ||
          scriptExtensions.has(extension) ||
          yamlExtensions.has(extension) ||
          jsonExtensions.has(extension)) &&
        !upstreamOrGenerated.some((path) =>
          path.endsWith("/") ? file.startsWith(path) : file === path,
        ) &&
        existsSync(join(root, file))
      );
    })
    .map(
      (file) =>
        [file, scan(file, readFileSync(join(root, file), "utf8"))] as const,
    );
}

function fingerprint(text: string) {
  return createHash("sha256")
    .update(text.replaceAll("\r\n", "\n"))
    .digest("hex")
    .slice(0, 16);
}

function fingerprints(value: string | undefined) {
  return value?.split(" ") ?? [];
}

function consume(remaining: Map<string, number>, key: string) {
  const count = remaining.get(key);
  if (!count) return false;
  remaining.set(key, count - 1);
  return true;
}

function allowances(keys: string[]) {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

function previousBaseline(): Baseline | undefined {
  const options = { cwd: root, encoding: "utf8" as const, maxBuffer: 1 << 24 };
  const base = spawnSync(
    "git",
    ["merge-base", "HEAD", `origin/${SOURCE_BRANCH}`],
    options,
  );
  if (base.status !== 0) return undefined;
  const baseline = spawnSync(
    "git",
    ["show", `${base.stdout.trim()}:${baselinePath}`],
    options,
  );
  return baseline.status === 0
    ? (JSON.parse(baseline.stdout) as Baseline)
    : undefined;
}

function main(mode: string | undefined) {
  const files = inventory();
  if (mode === "inventory") {
    for (const [, result] of files) {
      for (const comment of result.comments)
        console.log(JSON.stringify(comment));
    }
    return;
  }
  if (mode === "count") {
    console.log(
      JSON.stringify(
        files.reduce(
          (total, [, result]) => ({
            files: total.files + 1,
            comments: total.comments + result.comments.length,
            commentOnlyLines: total.commentOnlyLines + result.commentOnlyLines,
            mixedLines: total.mixedLines + result.mixedLines,
          }),
          { files: 0, comments: 0, commentOnlyLines: 0, mixedLines: 0 },
        ),
      ),
    );
    return;
  }
  if (mode !== "check" && mode !== "prune")
    throw new Error("Use check, prune, count, or inventory.");

  const path = join(root, baselinePath);
  const baseline = JSON.parse(readFileSync(path, "utf8")) as Baseline;
  const previous = previousBaseline();
  const updated: Baseline = {};
  const errors: string[] = [];
  if (previous) {
    for (const [file, value] of Object.entries(baseline)) {
      const allowed = allowances(fingerprints(previous[file]));
      if (fingerprints(value).some((key) => !consume(allowed, key))) {
        errors.push(
          `${file}: the comment baseline gained entries since the merge base`,
        );
      }
    }
  }

  for (const [file, { comments }] of files) {
    const remaining = allowances(fingerprints(baseline[file]));
    const kept: string[] = [];
    for (const comment of comments) {
      const key = fingerprint(comment.text);
      if (consume(remaining, key)) kept.push(key);
      else
        errors.push(
          `${file}:${comment.line}: remove the new or edited comment and put design rationale in an ADR`,
        );
    }
    if (kept.length > 0) updated[file] = kept.sort().join(" ");
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  if (mode === "prune") {
    writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`);
  } else if (
    Object.entries(baseline).some(([file, value]) => updated[file] !== value)
  ) {
    console.error(
      "The comment baseline has retired entries. Run pnpm comments prune.",
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) main(process.argv[2]);
