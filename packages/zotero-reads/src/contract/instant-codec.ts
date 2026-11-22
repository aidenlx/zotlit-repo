import { Schema, SchemaGetter } from "effect";

export const Instant = Schema.String.pipe(
  Schema.decodeTo(Schema.instanceOf(Temporal.Instant), {
    decode: SchemaGetter.transform((s: string) => Temporal.Instant.from(s)),
    encode: SchemaGetter.transform((i: Temporal.Instant) => i.toString()),
  }),
);
