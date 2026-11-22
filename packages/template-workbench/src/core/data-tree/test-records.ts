export function withText<T extends object>(record: T, text: string): T {
  Object.defineProperty(record, "toString", {
    value: () => text,
    enumerable: false,
  });
  return record;
}
