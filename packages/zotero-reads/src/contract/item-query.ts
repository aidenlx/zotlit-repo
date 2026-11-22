import type { DecodedQuery, DecodedValues } from "./query-codec.ts";

export interface ItemQueryJobShape {
  readonly id: string;
  readonly command: string;
  readonly query?: DecodedQuery;
  readonly values?: DecodedValues;
}

export interface ItemQueryAnswerShape {
  readonly command: string;
}

// oxlint-disable-next-line typescript/no-empty-object-type -- the host fills it by declaration merging
export interface ItemQueryTypes {}

export type ItemQueryJob = ItemQueryTypes extends {
  job: infer Job extends ItemQueryJobShape;
}
  ? Job
  : ItemQueryJobShape;

export type ItemQueryAnswer = ItemQueryTypes extends {
  answer: infer Answer extends ItemQueryAnswerShape;
}
  ? Answer
  : ItemQueryAnswerShape;
