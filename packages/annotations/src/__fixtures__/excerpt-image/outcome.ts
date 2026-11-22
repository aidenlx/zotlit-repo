import type { ExcerptOutcome } from "#obsidian/excerpt-image/service.ts";

const FIXTURE_IDENTITY = {
  key: "fixture-key",
  fingerprint: "fixture-fingerprint",
  pdf: null,
};

export function availableOutcome(
  outcome: Omit<
    Extract<ExcerptOutcome, { kind: "available" }>,
    "kind" | "identity"
  >,
): Extract<ExcerptOutcome, { kind: "available" }> {
  return { kind: "available", ...outcome, identity: FIXTURE_IDENTITY };
}
