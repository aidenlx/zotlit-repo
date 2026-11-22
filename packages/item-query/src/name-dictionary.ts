declare const prototypeFree: unique symbol;

export type NameDictionary<V> = { readonly [name: string]: V } & {
  readonly [prototypeFree]: true;
};

export function nameDictionary<V>(
  entries: Iterable<readonly [string, V]> = [],
): NameDictionary<V> {
  const dictionary = Object.create(null) as Record<string, V>;
  for (const [name, value] of entries) dictionary[name] = value;
  return dictionary as NameDictionary<V>;
}
