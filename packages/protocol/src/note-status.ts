import * as v from "valibot";

import { isIndexedKey } from "@zotlit/zotero-types/keys";

const indexedKeyValue = v.pipe(v.string(), v.check(isIndexedKey));

export const noteStatusResponseSchema = v.object({
  keys: v.array(indexedKeyValue),
});

export type NoteStatusResponse = v.InferOutput<typeof noteStatusResponseSchema>;
