export function frontmatterInstant(
  value: unknown,
): Temporal.Instant | undefined {
  return value instanceof Date
    ? Temporal.Instant.fromEpochMilliseconds(value.getTime())
    : undefined;
}
