import {
  describeDatasetVocabulary,
  describeQuery,
} from "./describe-item-query.ts";
import { ATTACHMENTS } from "./query-attachments.ts";

/** Source-independent Attachment vocabulary; generated only at build time. */
export function describeAttachmentQueryVocabulary() {
  return describeDatasetVocabulary(ATTACHMENTS);
}

export const describeAttachmentQuery = () => describeQuery(ATTACHMENTS, {});
