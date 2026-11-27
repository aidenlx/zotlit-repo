import { regex } from "arkregex";

const ISO_8601_RE = regex(
  "^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2})(?:T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]+))?)?(Z|[-+][0-9]{2}:[0-9]{2})?)?)?)?$",
);
const SQL_DATE_RE = /^-?[0-9]{4}-(0[1-9]|10|11|12)-(0[1-9]|[1-2][0-9]|30|31)$/;

export function isoToSql(
  value: string | undefined,
  timeZone: string,
): string | null {
  const m = value ? ISO_8601_RE.exec(value) : null;
  if (!m) return null;
  const [
    ,
    year,
    month = "01",
    day = "01",
    hour,
    minute,
    second = "00",
    fraction = "0",
    offset,
  ] = m;
  const endOfDay = hour === "24";
  if (
    endOfDay &&
    (minute !== "00" || second !== "00" || !/^0+$/.test(fraction))
  ) {
    return null;
  }
  try {
    const given = Temporal.PlainDate.from(
      { year: Number(year), month: Number(month), day: Number(day) },
      { overflow: "reject" },
    );
    const date = endOfDay ? given.add({ days: 1 }) : given;
    const instant =
      hour === undefined
        ? date.toZonedDateTime("UTC").toInstant()
        : date
            .toPlainDateTime(
              Temporal.PlainTime.from(
                {
                  hour: endOfDay ? 0 : Number(hour),
                  minute: Number(minute),
                  second: Number(second),
                },
                { overflow: "reject" },
              ),
            )
            .toZonedDateTime(
              offset === undefined ? timeZone : offset === "Z" ? "UTC" : offset,
            )
            .toInstant();
    return instantToSql(instant);
  } catch {
    return null;
  }
}

export function accessDateToSql(
  value: string,
  timeZone: string,
): string | undefined {
  if (SQL_DATE_RE.test(value)) return value;
  return isoToSql(value, timeZone) ?? undefined;
}

export function instantToSql(instant: Temporal.Instant): string {
  return instant
    .toString({ smallestUnit: "second" })
    .slice(0, -1)
    .replace("T", " ");
}
