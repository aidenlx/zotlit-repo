export interface TagCandidateLeaf {
  readonly kind: "tag";
  readonly value: string;
}

export interface KeysCandidateLeaf {
  readonly kind: "keys";
  readonly keys: readonly string[];
}
