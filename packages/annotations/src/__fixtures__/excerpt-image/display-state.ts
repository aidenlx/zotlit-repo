import type {
  ExcerptDisplayDemand,
  ExcerptImageDisplay,
} from "#desktop/excerpt-image/display.ts";

export function settledDisplay(
  demand: ExcerptDisplayDemand,
  matches: (display: ExcerptImageDisplay) => boolean,
): Promise<ExcerptImageDisplay> {
  const next = Promise.withResolvers<ExcerptImageDisplay>();
  const onChange = () => {
    const snapshot = demand.snapshot();
    if (matches(snapshot)) next.resolve(snapshot);
  };
  const off = demand.subscribe(onChange);
  onChange();
  return next.promise.finally(off);
}
