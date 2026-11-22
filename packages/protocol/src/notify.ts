import * as v from "valibot";

const debugDirs = v.object({
  profilePath: v.optional(v.string()),
  dataPath: v.optional(v.string()),
});

export const dbUpdatedSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("db/updated"),
});

export const readerAnnotSelectSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("reader/annot-select"),
  itemID: v.number(),
  attachmentID: v.number(),
  selected: v.array(v.number()),
});

export const readerActiveSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("reader/active"),
  itemID: v.number(),
  attachmentID: v.number(),
  selected: v.array(v.number()),
});

export const readerInactiveSchema = v.object({
  ...debugDirs.entries,
  event: v.literal("reader/inactive"),
});

export type DbUpdated = v.InferOutput<typeof dbUpdatedSchema>;
export type ReaderAnnotSelect = v.InferOutput<typeof readerAnnotSelectSchema>;
export type ReaderActive = v.InferOutput<typeof readerActiveSchema>;
export type ReaderInactive = v.InferOutput<typeof readerInactiveSchema>;

export const notifyEventSchema = v.variant("event", [
  dbUpdatedSchema,
  readerAnnotSelectSchema,
  readerActiveSchema,
  readerInactiveSchema,
]);

export type NotifyEvent = v.InferOutput<typeof notifyEventSchema>;
