import { regex } from "arkregex";

export const MAX_SNAPSHOT_LINES = 600;

const ENTRY_START = regex("^exports\\[`(?<name>.*)`\\] = `");

export interface LargeSnapshot {
  readonly name: string;
  readonly lines: number;
}

export function largeSnapshots(
  text: string,
  maxLines = MAX_SNAPSHOT_LINES,
): LargeSnapshot[] {
  const large: LargeSnapshot[] = [];
  let open: { name: string; start: number } | undefined;
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    const start = open ? null : ENTRY_START.exec(line);
    if (start) open = { name: start.groups.name, start: index };
    if (open && line.endsWith("`;") && (line === "`;" || start)) {
      const count = index - open.start + 1;
      if (count > maxLines) large.push({ name: open.name, lines: count });
      open = undefined;
    }
  }
  return large;
}

export function largeSnapshotsMessage(
  files: readonly {
    readonly path: string;
    readonly large: readonly LargeSnapshot[];
  }[],
): string {
  return [
    `These snapshot entries exceed ${MAX_SNAPSHOT_LINES} lines:`,
    ...files.flatMap(({ path, large }) =>
      large.map(({ name, lines }) => `  ${path}: ${name} (${lines} lines)`),
    ),
    "Index the output and assert the keys the test owns instead of snapshotting it whole.",
  ].join("\n");
}
