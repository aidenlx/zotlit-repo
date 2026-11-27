import { missingCustomField } from "./custom-field-uses.ts";
import type { Diagnostic } from "./diagnose.ts";
import { ItemQueryError } from "./error.ts";
import type { ItemQueryErrorCode } from "./error.ts";
import type { QueryItem } from "./fields.ts";
import { matches } from "./filter-evaluate.ts";
import { planFilter } from "./filter-plan.ts";
import { queryItemFrom } from "./item-seed.ts";
import type { QueryItemSeed } from "./item-seed.ts";
import type { QueryClock } from "./query-clock.ts";
import { ITEMS } from "./query-items.ts";

export interface ItemFilter {
  readonly matches: (item: QueryItem, clock?: QueryClock) => boolean;
}

export function planItemFilter(
  text: string,
): ItemFilter | Diagnostic<ItemQueryErrorCode> {
  const planned = plan(text);
  if ("code" in planned) return planned;
  return {
    matches: (item, clock = nowClock()) => matches(planned.root, item, clock),
  };
}

function plan(text: string) {
  const planned = planFilter(text);
  if ("kind" in planned)
    return new ItemQueryError({
      dataset: ITEMS,
      fault: planned,
      location: {
        argument: "filter",
        span:
          planned.kind === "syntax"
            ? { from: planned.fault.from, to: planned.fault.to }
            : planned.at,
      },
      argumentText: text,
    }).diagnostic;
  return planned;
}

export type SeedTest =
  | { readonly kind: "result"; readonly matched: boolean }
  | {
      readonly kind: "problem";
      readonly diagnostic: Diagnostic<ItemQueryErrorCode>;
    }
  | { readonly kind: "unavailable" };

export function testItemSeed(
  text: string,
  seed: QueryItemSeed,
  clock: QueryClock = nowClock(),
): SeedTest {
  const planned = plan(text);
  if ("code" in planned) return { kind: "problem", diagnostic: planned };
  const missing = missingCustomField(planned, seed.customFieldNames);
  if (missing)
    return {
      kind: "problem",
      diagnostic: new ItemQueryError({
        dataset: ITEMS,
        fault: missing.fault,
        location: { argument: "filter", span: missing.at },
        argumentText: text,
      }).diagnostic,
    };
  if (
    planned.needs.some(
      (needs) =>
        needs.attachments !== undefined ||
        needs.annotations !== undefined ||
        needs.notes !== undefined,
    )
  )
    return { kind: "unavailable" };
  return {
    kind: "result",
    matched: matches(planned.root, queryItemFrom(seed), clock),
  };
}

function nowClock(): QueryClock {
  return { now: Temporal.Now.instant(), timeZone: Temporal.Now.timeZoneId() };
}
