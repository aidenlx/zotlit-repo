export type GateHalf = "local" | "pr";

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

export const GATE_HALF_FLAGS = {
  local: "--local",
  pr: "--pr",
} as const satisfies Record<GateHalf, string>;

export function halfOf(step: GateStep): GateHalf {
  return GATE_STEPS[step];
}

export function gateSteps(half: GateHalf): GateStep[] {
  return (Object.keys(GATE_STEPS) as GateStep[]).filter(
    (step) => GATE_STEPS[step] === half,
  );
}

export function verifyHalf(half: GateHalf) {
  return ["pnpm", "verify", GATE_HALF_FLAGS[half]] as const;
}
