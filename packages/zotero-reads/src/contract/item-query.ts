import type { DecodedQuery, DecodedValues } from "./query-codec.ts";

export interface ItemQueryJobShape {
  readonly id: string;
  readonly command: string;
  readonly query?: DecodedQuery;
  readonly values?: DecodedValues;
}

export interface ItemQueryTypedJobShape {
  readonly id: string;
  readonly command: string;
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

export type ItemQueryTypedJob = ItemQueryTypes extends {
  typedJob: infer Job extends ItemQueryTypedJobShape;
}
  ? Job
  : ItemQueryTypedJobShape;

export type ItemQuerySummary = ItemQueryTypes extends {
  summary: infer Summary extends object;
}
  ? Summary
  : object;

export type ItemQueryMeasurement = ItemQueryTypes extends {
  measurement: infer Measurement extends object;
}
  ? Measurement
  : object;

export type ItemQueryDiagnostic = ItemQueryTypes extends {
  diagnostic: infer Diagnostic extends object;
}
  ? Diagnostic
  : object;

export type ItemQueryAnswer = ItemQueryTypes extends {
  answer: infer Answer extends ItemQueryAnswerShape;
}
  ? Answer
  : ItemQueryAnswerShape;
