export function coerceToString(value: unknown): string {
  return Reflect.apply(String, undefined, [value]);
}
