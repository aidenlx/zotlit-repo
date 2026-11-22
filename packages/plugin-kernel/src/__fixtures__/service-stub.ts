export function stubService<S extends object>(
  name: string,
  members: Partial<S>,
): S {
  return new Proxy(members, {
    get(target, key, receiver) {
      if (typeof key === "symbol" || key === "then" || key in target)
        return Reflect.get(target, key, receiver);
      throw new Error(`${name} stub lacks "${key}"`);
    },
  }) as S;
}
