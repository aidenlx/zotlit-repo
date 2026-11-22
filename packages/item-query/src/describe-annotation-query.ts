import { ANNOTATION_POSITION_SHAPES } from "./annotation-position.ts";
import {
  describeDatasetVocabulary,
  describeQuery,
} from "./describe-item-query.ts";
import { ANNOTATIONS } from "./query-annotations.ts";

export function describeAnnotationQueryVocabulary() {
  return {
    ...describeDatasetVocabulary(ANNOTATIONS),
    positionKinds: ANNOTATION_POSITION_SHAPES,
  };
}

export const describeAnnotationQuery = () =>
  describeQuery(ANNOTATIONS, {
    positionKinds: ANNOTATION_POSITION_SHAPES,
  });
