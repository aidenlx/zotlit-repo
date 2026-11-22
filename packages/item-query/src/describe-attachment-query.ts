import {
  describeDatasetVocabulary,
  describeQuery,
} from "./describe-item-query.ts";
import { ATTACHMENTS } from "./query-attachments.ts";

export function describeAttachmentQueryVocabulary() {
  return describeDatasetVocabulary(ATTACHMENTS);
}

export const describeAttachmentQuery = () => describeQuery(ATTACHMENTS, {});
