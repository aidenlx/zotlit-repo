import { Schema } from "effect";

const AccessFlags = Schema.Struct({
  library: Schema.optional(Schema.Boolean),
});
export const KeyDescription = Schema.Struct({
  userID: Schema.Int,
  username: Schema.String,
  access: Schema.Struct({
    user: Schema.optional(AccessFlags),
    groups: Schema.optional(Schema.Record(Schema.String, AccessFlags)),
  }),
});
export const VersionMap = Schema.Record(Schema.String, Schema.Int);
export const ObjectList = Schema.Array(
  Schema.Struct({
    key: Schema.NonEmptyString,
    version: Schema.Int,
    data: Schema.Struct({ key: Schema.NonEmptyString, version: Schema.Int }),
  }),
);
export const DeletionList = Schema.Struct({
  collections: Schema.Array(Schema.String),
  items: Schema.Array(Schema.String),
  settings: Schema.optional(Schema.Array(Schema.String)),
});
export const SettingList = Schema.Record(
  Schema.String,
  Schema.Struct({ value: Schema.Unknown, version: Schema.Int }),
);
export const GroupRecord = Schema.Struct({
  id: Schema.Int,
  version: Schema.Int,
  data: Schema.Struct({ name: Schema.String }),
});
