// The quoting follows denoland/std `csv/stringify.ts` (@std/csv 1.0.6).
// Original implementation © 2018-2026 the Deno authors, MIT License.

export const DELIMITED_FORMATS = ["csv", "tsv"] as const;
export type DelimitedFormat = (typeof DELIMITED_FORMATS)[number];

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const FORMATS: Record<
  DelimitedFormat,
  { separator: string; newline: string; bom: string }
> = {
  csv: { separator: ",", newline: "\r\n", bom: BYTE_ORDER_MARK },
  tsv: { separator: "\t", newline: "\n", bom: "" },
};

function cellText(cell: string, separator: string): string {
  return cell.includes(separator) || /["\n\r]/.test(cell)
    ? `"${cell.replaceAll('"', '""')}"`
    : cell;
}

export function delimitedStart(format: DelimitedFormat): string {
  return FORMATS[format].bom;
}

export function delimitedLines(
  lines: readonly (readonly string[])[],
  format: DelimitedFormat,
): string {
  const { separator, newline } = FORMATS[format];
  return lines
    .map(
      (line) =>
        line.map((cell) => cellText(cell, separator)).join(separator) + newline,
    )
    .join("");
}

export function delimited(
  lines: readonly (readonly string[])[],
  format: DelimitedFormat,
): string {
  return delimitedStart(format) + delimitedLines(lines, format);
}
