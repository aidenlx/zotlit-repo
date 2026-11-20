import type { ReaderHost } from "#/core/host.ts";
import type { ReaderState } from "#/core/types.ts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export interface StoredPosition {
  readonly fingerprint: string;
  readonly pageIndex: number;
  readonly left: number;
  readonly top: number;
  readonly spread?: ReaderState["spread"];
}

const POSITIONS_KEY = "positions";
const KEPT = 20;

const Spread = Schema.Literals(["none", "odd", "even"]);

const Positions = Schema.Array(
  Schema.Struct({
    fingerprint: Schema.String,
    pageIndex: Schema.Finite,
    left: Schema.Finite,
    top: Schema.Finite,
    spread: Schema.optionalKey(Spread),
  }),
);

const decodePositions = Schema.decodeUnknownOption(Positions);

function stored(host: ReaderHost): readonly StoredPosition[] {
  return Option.getOrElse(
    decodePositions(host.storage.get(POSITIONS_KEY)),
    () => [],
  );
}

export function readPosition(
  host: ReaderHost,
  fingerprint: string,
): StoredPosition | null {
  return (
    stored(host).find((entry) => entry.fingerprint === fingerprint) ?? null
  );
}

export function writePosition(
  host: ReaderHost,
  position: StoredPosition,
): void {
  const others = stored(host).filter(
    (entry) => entry.fingerprint !== position.fingerprint,
  );
  host.storage.set(POSITIONS_KEY, [position, ...others].slice(0, KEPT));
}
