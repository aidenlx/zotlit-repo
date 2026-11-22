export function coerceOutput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Temporal.Instant) {
    return value
      .toZonedDateTimeISO(Temporal.Now.timeZoneId())
      .toPlainDate()
      .toString();
  }
  // oxlint-disable-next-line no-base-to-string
  return String(value);
}
