// What an `obsidian://zotlit/<action>` link ends with when the link itself
// decides it: a refusal, or the open it names. Each feature's handlers add
// the outcomes of their own runs to these.
import { Data, Result } from "effect";

/** The outcomes every link handler shares. */
export type LinkOutcomeVariants = {
  /** The link's query does not parse. */
  InvalidLink: object;
  /** The link names another Zotero, so the handler leaves it. */
  ForeignSource: object;
  /** The Zotero database is not ready for the item the link names. */
  DatabaseUnavailable: object;
  /** The link names an id with no live item. */
  ItemNotFound: object;
  /** What the link names opened. */
  Opened: object;
};

export type LinkOutcome = Data.TaggedEnum<LinkOutcomeVariants>;

export const LinkOutcome = Data.taggedEnum<LinkOutcome>();

/** A refused link: the handler stops with `outcome`. */
export const refuse = (
  outcome: LinkOutcome,
): Result.Result<never, LinkOutcome> => Result.fail(outcome);
