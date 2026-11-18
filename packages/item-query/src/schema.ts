/** Build-only access to the registry-derived Query Schema catalog. */
import { describeAnnotationQueryVocabulary } from "./describe-annotation-query.ts";
import { describeAttachmentQueryVocabulary } from "./describe-attachment-query.ts";
import { describeItemQueryVocabulary } from "./describe-item-query.ts";
import { FORMULA_SCHEMA } from "./formulas.ts";
import {
  ITEM_SUMMARY,
  ATTACHMENT_SUMMARY,
  ANNOTATION_SUMMARY,
} from "./record-vocabularies.ts";

export {
  describeItemQuery,
  describeItemQueryVocabulary,
  describeQuery,
} from "./describe-item-query.ts";
export {
  describeAnnotationQuery,
  describeAnnotationQueryVocabulary,
} from "./describe-annotation-query.ts";

/** One static catalog per plugin version, with shared language definitions. */
export function describeQueryVocabulary() {
  const { context, functions, methods, properties, types, ...items } =
    describeItemQueryVocabulary();
  const {
    context: _context,
    functions: _functions,
    methods: _methods,
    properties: _properties,
    types: _types,
    ...annotations
  } = describeAnnotationQueryVocabulary();
  const {
    context: _ac,
    functions: _af,
    methods: _am,
    properties: _ap,
    types: _at,
    ...attachments
  } = describeAttachmentQueryVocabulary();
  return {
    datasets: {
      items: { ...items, summary: ITEM_SUMMARY },
      attachments: { ...attachments, summary: ATTACHMENT_SUMMARY },
      annotations: { ...annotations, summary: ANNOTATION_SUMMARY },
    },
    context,
    formulas: FORMULA_SCHEMA,
    functions,
    methods,
    properties,
    types,
  };
}

export {
  describeAttachmentQuery,
  describeAttachmentQueryVocabulary,
} from "./describe-attachment-query.ts";
