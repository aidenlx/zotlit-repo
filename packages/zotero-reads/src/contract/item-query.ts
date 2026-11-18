// The Query Job and its answer, as the ZoteroReads contract carries them. The
// host's Item Query adapter owns their full shapes and names them in
// `ItemQueryTypes`; the contract reads only the fields below, and the host's
// Item Query adapter runs every job (`QueryJobRunner` of the handlers).
import type { DecodedQuery, DecodedValues } from "./query-codec.ts";

/** What the contract reads of a Query Job. */
export interface ItemQueryJobShape {
  readonly id: string;
  /** The CLI command the envelope names. */
  readonly command: string;
  /** The query the renderer decoded; it crosses through its own codec. */
  readonly query?: DecodedQuery;
  /** The values listing the renderer decoded; it crosses through its own codec. */
  readonly values?: DecodedValues;
}

/** What the contract reads of an answer: an object, as JSON carries it. */
export interface ItemQueryAnswerShape {
  /** The CLI command the envelope names. */
  readonly command: string;
}

/**
 * The host's Query Job and answer types. The host adds `job` and `answer` by
 * declaration merging (`declare module` on this file); without them the
 * contract carries the shapes above.
 */
// oxlint-disable-next-line typescript/no-empty-object-type -- the host fills it by declaration merging
export interface ItemQueryTypes {}

/** The Query Job of the host. */
export type ItemQueryJob = ItemQueryTypes extends {
  job: infer Job extends ItemQueryJobShape;
}
  ? Job
  : ItemQueryJobShape;

/** The answer of the host's Item Query adapter to one job. */
export type ItemQueryAnswer = ItemQueryTypes extends {
  answer: infer Answer extends ItemQueryAnswerShape;
}
  ? Answer
  : ItemQueryAnswerShape;
