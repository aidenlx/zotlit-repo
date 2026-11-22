export interface MessageKey {
  readonly key: string;
  readonly names: readonly string[];
}

export function messageKeys(
  catalog: Readonly<Record<string, unknown>>,
): MessageKey[] {
  const keys: MessageKey[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    if (key.startsWith("$")) continue;
    if (key !== "zotero") {
      keys.push({ key, names: [key] });
      continue;
    }
    for (const name of Object.keys(value as Record<string, unknown>))
      keys.push({
        key: `zotero.${name}`,
        names: [`zotero.${name}`, `zotlit-${name.replaceAll("_", "-")}`],
      });
  }
  return keys;
}

export function unusedMessageKeys(
  keys: readonly MessageKey[],
  sources: Iterable<string>,
): string[] {
  const words = new Set<string>();
  for (const source of sources)
    for (const word of source.matchAll(/[\w.-]+/g)) {
      words.add(word[0]);
      for (const part of word[0].split(".")) words.add(part);
    }
  return keys
    .filter(({ names }) => !names.some((name) => words.has(name)))
    .map(({ key }) => key);
}

export function compareWithBaseline(
  unused: readonly string[],
  baseline: readonly string[],
  keys: readonly MessageKey[],
): { added: string[]; used: string[]; gone: string[] } {
  const known = new Set(keys.map(({ key }) => key));
  const now = new Set(unused);
  const before = new Set(baseline);
  return {
    added: unused.filter((key) => !before.has(key)),
    used: baseline.filter((key) => known.has(key) && !now.has(key)),
    gone: baseline.filter((key) => !known.has(key)),
  };
}
