export type GateHalf = "local" | "pr";

const GATE_STEPS = {
  Format: "local",
  "Generated artifacts": "local",
  Lint: "local",
  "Snapshot size": "local",
  "Record risk": "local",
  "Record file": "local",
  "Agent guides": "local",
  Test: "pr",
  Bundle: "pr",
} as const satisfies Record<string, GateHalf>;

export type GateStep = keyof typeof GATE_STEPS;

export const GATE_HALF_FLAGS = {
  local: "--local",
  pr: "--pr",
} as const satisfies Record<GateHalf, string>;

const AGENT_DOCS_STEPS: ReadonlySet<GateStep> = new Set([
  "Format",
  "Generated artifacts",
  "Agent guides",
]);
const LINT_COVERS: ReadonlySet<GateStep> = new Set(["Agent guides"]);

export function gateSteps(
  half: GateHalf,
  { agentDocsOnly = false }: { agentDocsOnly?: boolean } = {},
): GateStep[] {
  return (Object.keys(GATE_STEPS) as GateStep[]).filter(
    (step) =>
      GATE_STEPS[step] === half &&
      (agentDocsOnly ? AGENT_DOCS_STEPS.has(step) : !LINT_COVERS.has(step)),
  );
}

export function verifyHalf(half: GateHalf) {
  return ["pnpm", "verify", GATE_HALF_FLAGS[half]] as const;
}
