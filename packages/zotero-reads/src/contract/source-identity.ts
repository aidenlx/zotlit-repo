import { Schema } from "effect";

export const SourceIdentitySchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("file"),
    id: Schema.NullOr(Schema.String),
    databasePath: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("web-api"),
    id: Schema.String,
    userID: Schema.NullOr(Schema.Int),
    username: Schema.NullOr(Schema.String),
  }).check(
    Schema.makeFilter(
      ({ id, userID }) =>
        id === webApiSourceId(userID) ||
        `id must be ${webApiSourceId(userID)}, the source ID of its account`,
    ),
  ),
]);

export function webApiSourceId(userID: number | null): string {
  return `web-api:${userID ?? "unsynced"}`;
}

export type SourceIdentity = typeof SourceIdentitySchema.Type;
