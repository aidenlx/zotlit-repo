import { describe, expect, it } from "vitest";

import type { ReplicaAction, ReplicaFacts } from "./replica-plan.ts";
import { plan } from "./replica-plan.ts";

const A = 42;
const B = 99;

type Row = readonly [
  name: string,
  facts: Omit<ReplicaFacts, "zoteroLocale">,
  decision: ReplicaAction,
];

const base = {
  keyUserID: A,
  readsLibraries: true,
  consentedUserID: A,
  storedUserID: A,
  replicaLocale: "en-US",
  committed: true,
} as const;

const refused = (
  consentedUserID: number | null,
  storedUserID: number | null,
  keyUserID: number,
) => ({ kind: "refuse", consentedUserID, storedUserID, keyUserID }) as const;

const ROWS: readonly Row[] = [
  [
    "no consent, empty replica",
    {
      ...base,
      consentedUserID: undefined,
      storedUserID: undefined,
      replicaLocale: null,
      committed: false,
    },
    { kind: "await-consent", keyUserID: A },
  ],
  [
    "no consent, replica of the key's account",
    { ...base, consentedUserID: undefined },
    { kind: "await-consent", keyUserID: A },
  ],
  [
    "no consent, replica of another account",
    { ...base, keyUserID: B, consentedUserID: undefined },
    refused(null, A, B),
  ],
  [
    "no consent, a partial build of another account",
    {
      ...base,
      keyUserID: B,
      consentedUserID: undefined,
      replicaLocale: null,
      committed: false,
    },
    refused(null, A, B),
  ],
  [
    "consent A, key B, empty replica",
    {
      ...base,
      keyUserID: B,
      storedUserID: undefined,
      replicaLocale: null,
      committed: false,
    },
    refused(A, null, B),
  ],
  [
    "consent A, key B, replica of A in another language",
    { ...base, keyUserID: B, replicaLocale: "en-GB" },
    refused(A, A, B),
  ],
  [
    "consent B after Replace data, key B, replica of A",
    { ...base, keyUserID: B, consentedUserID: B },
    { kind: "rebuild", reason: "account" },
  ],
  [
    "consent B after Replace data, key A again, replica of A",
    { ...base, consentedUserID: B },
    refused(B, A, A),
  ],
  [
    "consent B after Replace data, key C",
    { ...base, keyUserID: 7, consentedUserID: B },
    refused(B, A, 7),
  ],
  [
    "consent A, a key of A that reads no library, replica in another language",
    { ...base, readsLibraries: false, replicaLocale: "en-GB" },
    { kind: "no-access" },
  ],
  [
    "consent A, a key of A that reads no library, empty replica",
    {
      ...base,
      readsLibraries: false,
      storedUserID: undefined,
      replicaLocale: null,
      committed: false,
    },
    { kind: "no-access" },
  ],
  [
    "consent A, key A, empty replica",
    { ...base, storedUserID: undefined, replicaLocale: null, committed: false },
    { kind: "first-build" },
  ],
  [
    "consent A, key A, a partial build with no committed library",
    { ...base, replicaLocale: null, committed: false },
    { kind: "first-build" },
  ],
  [
    "consent A, key A, replica in the configured language",
    base,
    { kind: "incremental" },
  ],
  [
    "consent A, key A, replica in another language",
    { ...base, replicaLocale: "en-GB" },
    { kind: "rebuild", reason: "language" },
  ],
  [
    "consent A, key A, committed replica with no recorded language",
    { ...base, replicaLocale: null },
    { kind: "rebuild", reason: "language" },
  ],
];

describe("the plan of the Worker over its replica", () => {
  it.each(ROWS)("%s", (_name, facts, decision) => {
    expect(plan({ ...facts, zoteroLocale: "en-US" })).toEqual(decision);
  });

  it("deletes or downloads only for the consented account, and downloads only into a replica of that account in the configured language, for every combination of facts", () => {
    const violations: string[] = [];
    for (const readsLibraries of [true, false])
      for (const keyUserID of [A, B])
        for (const consentedUserID of [undefined, A, B])
          for (const storedUserID of [undefined, A, B])
            for (const replicaLocale of [null, "en-US", "en-GB"])
              for (const committed of [false, true]) {
                const facts = {
                  keyUserID,
                  readsLibraries,
                  consentedUserID,
                  storedUserID,
                  replicaLocale,
                  committed,
                  zoteroLocale: "en-US",
                };
                const { kind } = plan(facts);
                const downloads =
                  kind === "first-build" || kind === "incremental";
                const acts = downloads || kind === "rebuild";
                const intoKept =
                  downloads &&
                  ((storedUserID !== undefined && storedUserID !== keyUserID) ||
                    (replicaLocale === null
                      ? committed
                      : replicaLocale !== "en-US"));
                if (
                  (acts &&
                    (keyUserID !== consentedUserID || !readsLibraries)) ||
                  intoKept
                )
                  violations.push(`${JSON.stringify(facts)} -> ${kind}`);
              }
    expect(violations).toEqual([]);
  });
});
