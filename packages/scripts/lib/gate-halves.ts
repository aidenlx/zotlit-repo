// The two halves of the quality gate `pnpm verify` (ADR 0102): the local
// half, which `pnpm land` runs in its Land Turn, and the PR half, which the
// record PR runs on a hosted runner (.github/workflows/record-pr.yml) before
// `main` moves. scripts/verify.ts runs the steps of the halves that its flag
// selects; the land's gate and the workflow's run line are built from the
// same table, and `pnpm lint` holds the workflow to it
// (lib/record-pr-workflow.ts).

/** A half of the gate: `local` in the Land Turn, `pr` in the record PR. */
export type GateHalf = "local" | "pr";

/** Each step of the gate, in the order verify runs it, and its half. */
const GATE_STEPS = {
  Format: "local",
  "Generated artifacts": "local",
  Lint: "local",
  Typecheck: "local",
  "Snapshot size": "local",
  Test: "pr",
  Bundle: "pr",
} as const satisfies Record<string, GateHalf>;

export type GateStep = keyof typeof GATE_STEPS;

/** The `pnpm verify` flag that runs one half alone. */
export const GATE_HALF_FLAGS = {
  local: "--local",
  pr: "--pr",
} as const satisfies Record<GateHalf, string>;

/** The half of `step`. */
export function halfOf(step: GateStep): GateHalf {
  return GATE_STEPS[step];
}

/** The steps of `half`, in the order verify runs them. */
export function gateSteps(half: GateHalf): GateStep[] {
  return (Object.keys(GATE_STEPS) as GateStep[]).filter(
    (step) => GATE_STEPS[step] === half,
  );
}

/** The command that runs `half` alone. */
export function verifyHalf(half: GateHalf) {
  return ["pnpm", "verify", GATE_HALF_FLAGS[half]] as const;
}
