export interface ReplicaFacts {
  readonly keyUserID: number;
  readonly readsLibraries: boolean;
  readonly consentedUserID: number | undefined;
  readonly storedUserID: number | undefined;
  readonly replicaLocale: string | null;
  readonly committed: boolean;
  readonly zoteroLocale: string;
}

export type ReplicaAction =
  | { readonly kind: "first-build" }
  | { readonly kind: "incremental" }
  | { readonly kind: "rebuild"; readonly reason: "account" | "language" }
  | { readonly kind: "await-consent"; readonly keyUserID: number }
  | { readonly kind: "no-access" }
  | {
      readonly kind: "refuse";
      readonly consentedUserID: number | null;
      readonly storedUserID: number | null;
      readonly keyUserID: number;
    };

export function planAccount(
  facts: Pick<ReplicaFacts, "keyUserID" | "consentedUserID" | "storedUserID">,
): Extract<ReplicaAction, { kind: "await-consent" | "refuse" }> | null {
  const { keyUserID, consentedUserID, storedUserID } = facts;
  const refuse = {
    kind: "refuse",
    consentedUserID: consentedUserID ?? null,
    storedUserID: storedUserID ?? null,
    keyUserID,
  } as const;
  if (consentedUserID === undefined)
    return storedUserID !== undefined && storedUserID !== keyUserID
      ? refuse
      : { kind: "await-consent", keyUserID };
  return keyUserID === consentedUserID ? null : refuse;
}

export function plan(facts: ReplicaFacts): ReplicaAction {
  const { consentedUserID, storedUserID } = facts;
  const account = planAccount(facts);
  if (account !== null) return account;
  if (!facts.readsLibraries) return { kind: "no-access" };
  if (storedUserID !== undefined && storedUserID !== consentedUserID)
    return { kind: "rebuild", reason: "account" };
  const built = facts.replicaLocale;
  if (built === null ? facts.committed : built !== facts.zoteroLocale)
    return { kind: "rebuild", reason: "language" };
  return facts.committed ? { kind: "incremental" } : { kind: "first-build" };
}
