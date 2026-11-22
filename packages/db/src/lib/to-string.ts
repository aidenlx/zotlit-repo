export function defineToString<T extends object>(
  obj: T,
  fn: (this: T) => string,
): T {
  Object.defineProperty(obj, "toString", {
    value: fn,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return obj;
}
