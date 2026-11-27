const ESCAPE = 0x1b;
const BELL = 0x07;
const TAB = 0x09;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/;
const STORED_COLOR = /\[[0-9;]+m/g;
const PASSED = /^\s*✓/;
const FAILED_TESTS = /⎯ Failed Tests \d+ ⎯/;
const FAILURE =
  /^\s*(FAIL\b|×|✖|❯ .*\(\d+ tests? \| \d+ failed)|\berror TS\d+|AssertionError|^\s*Error:/;
const ERROR_LINE = "##[error]";

function isPrintable(code: number): boolean {
  return (
    code === TAB ||
    (code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f))
  );
}

function skipSequence(line: string, at: number): number {
  const kind = line[at + 1];
  if (kind === "[") {
    let end = at + 2;
    while (end < line.length) {
      const code = line.charCodeAt(end);
      end += 1;
      if (code >= 0x40 && code <= 0x7e) break;
    }
    return end;
  }
  if (kind === "]" || kind === "P" || kind === "_" || kind === "^") {
    let end = at + 2;
    while (end < line.length) {
      const code = line.charCodeAt(end);
      if (code === BELL) return end + 1;
      if (code === ESCAPE && line[end + 1] === "\\") return end + 2;
      end += 1;
    }
    return end;
  }
  return at + 2;
}

function stripTerminalControl(line: string): string {
  let text = "";
  let at = 0;
  while (at < line.length) {
    const code = line.charCodeAt(at);
    if (code === ESCAPE) {
      at = skipSequence(line, at);
    } else {
      if (isPrintable(code)) text += line[at];
      at += 1;
    }
  }
  return text;
}

export function cleanCiLine(line: string): string {
  return stripTerminalControl(line.replace(TIMESTAMP, "")).replaceAll(
    STORED_COLOR,
    "",
  );
}

export function failedLogExcerpt(raw: string, maxLines = 60): string[] {
  const lines = raw.split("\n").map(cleanCiLine);
  const errorAt = lines.findLastIndex((line) => line.startsWith(ERROR_LINE));
  const end = errorAt === -1 ? lines.length : errorAt;
  const body = lines
    .slice(0, end)
    .filter(
      (line) =>
        line.trim() !== "" &&
        !line.startsWith(ERROR_LINE) &&
        !PASSED.test(line),
    );
  const summary = body.findLastIndex((line) => FAILED_TESTS.test(line));
  const first =
    summary === -1 ? body.findIndex((line) => FAILURE.test(line)) : summary;
  const start = first === -1 ? Math.max(0, body.length - maxLines) : first;
  const excerpt = body.slice(start, start + maxLines);
  return errorAt === -1 ? excerpt : [...excerpt, lines[errorAt]!];
}
