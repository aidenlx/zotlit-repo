import { Data, Result } from "effect";

export type LinkOutcomeVariants = {
  InvalidLink: object;
  ForeignSource: object;
  NeedsLocalZotero: object;
  DatabaseUnavailable: object;
  ItemNotFound: object;
  Opened: object;
};

export type LinkOutcome = Data.TaggedEnum<LinkOutcomeVariants>;

export const LinkOutcome = Data.taggedEnum<LinkOutcome>();

export const refuse = (
  outcome: LinkOutcome,
): Result.Result<never, LinkOutcome> => Result.fail(outcome);
