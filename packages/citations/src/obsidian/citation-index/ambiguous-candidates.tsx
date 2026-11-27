import type { AmbiguousCandidate } from "./ambiguity.ts";
import { candidateRow } from "./ambiguity.ts";

export function AmbiguousCandidates({
  candidates,
  textClass,
}: {
  candidates: readonly AmbiguousCandidate[];
  textClass: string;
}) {
  return (
    <ul className="zt:m-0 zt:flex zt:list-none zt:flex-col zt:gap-1 zt:p-0">
      {candidates.map((candidate) => {
        const row = candidateRow(candidate);
        return (
          <li key={candidate.indexedKey} className={textClass}>
            <div className="zt:text-foreground zt:select-text">
              {row.summary}
            </div>
            <div className="zt:flex zt:gap-2 zt:text-xs zt:text-muted-foreground">
              {row.library !== null && <span>{row.library}</span>}
              <span>{row.key}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
