import type { Parser } from "@lezer/common";
import { vi } from "vitest";

export function documentFocus(): Disposable {
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  return { [Symbol.dispose]: () => hasFocus.mockRestore() };
}

export function nodeNames(
  parser: Parser,
  source: string,
  { from = 0, to = source.length }: { from?: number; to?: number } = {},
): string[] {
  const names: string[] = [];
  parser.parse(source).iterate({
    from,
    to,
    enter(node) {
      if (node.from >= from && node.to <= to) names.push(node.name);
    },
  });
  return names;
}
