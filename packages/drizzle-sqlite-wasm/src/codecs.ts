import {
  bigintFromBlob,
  booleanFromInteger,
  bufferFromBytesIfAvailable,
  dateFromStoredMilliseconds,
  dateFromStoredSeconds,
  jsonFromBlob,
  refineSqliteCodecs,
} from "drizzle-orm/sqlite-core";

export const sqliteWasmCodecs = refineSqliteCodecs({
  integer: { normalize: Number },
  "integer:boolean": { normalize: booleanFromInteger },
  "integer:timestamp": { normalize: dateFromStoredSeconds },
  "integer:timestamp_ms": { normalize: dateFromStoredMilliseconds },
  real: { normalize: Number },
  "text:json": { normalize: JSON.parse },
  blob: { normalize: bufferFromBytesIfAvailable },
  "blob:json": { normalize: jsonFromBlob },
  "blob:bigint": { normalize: bigintFromBlob },
  numeric: { normalize: String },
  "numeric:number": { normalize: Number },
  "numeric:bigint": { normalize: BigInt },
});
