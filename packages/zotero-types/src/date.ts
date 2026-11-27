const MULTIPART_RE =
  /^[0-9]{4}-(?:0[0-9]|10|11|12)-(?:0[0-9]|[1-2][0-9]|30|31) /;
const SQL_DATETIME_RE =
  /^[0-9]{4}-(?:0[1-9]|10|11|12)-(?:0[1-9]|[1-2][0-9]|30|31) (?:[0-1][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?$/;

export function isMultipartDate(value: string): boolean {
  return !SQL_DATETIME_RE.test(value) && MULTIPART_RE.test(value);
}
