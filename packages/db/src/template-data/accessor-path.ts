export type TemplatePathSegment = string | number;

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function isAccessorIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

export function formatAccessorPath(
  segments: readonly TemplatePathSegment[],
  rootAlias?: string,
): string {
  let out = rootAlias ?? "";
  for (const segment of segments) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (!out && isAccessorIdentifier(segment)) {
      out = segment;
    } else {
      out += memberAccessor(segment);
    }
  }
  return out;
}

export function memberAccessor(name: string): string {
  return isAccessorIdentifier(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}
