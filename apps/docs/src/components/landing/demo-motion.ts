export interface DemoInputs {
  wasEligible: boolean;
  visibleRatio: number | null;
  reduced: boolean;
  paused: boolean;
  byReader: boolean;
}

export interface DemoMotion {
  eligible: boolean;
  turn?: "ask" | "take" | "end";
  frame?: "collection" | "finished";
}

export function demoMotion({
  wasEligible,
  visibleRatio,
  reduced,
  paused,
  byReader,
}: DemoInputs): DemoMotion {
  const allowed = !reduced && !paused;
  const eligible = allowed && (visibleRatio ?? 0) >= 0.5;
  if (eligible) {
    if (wasEligible) return { eligible };
    return byReader
      ? { eligible, turn: "take" }
      : { eligible, turn: "ask", frame: "collection" };
  }
  const turn = wasEligible ? "end" : undefined;
  if (allowed && (visibleRatio === 0 || byReader))
    return { eligible, turn, frame: "collection" };
  if (!allowed || wasEligible) return { eligible, turn, frame: "finished" };
  return { eligible, turn };
}
