import { Clock, Effect } from "effect";

import { SLICE_BUDGET_MS, valueText } from "@zotlit/item-query";
import type {
  ProjectionJson,
  QueryRow,
  QuerySummary,
} from "@zotlit/item-query";
import { monotonicMillis } from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { delimitedLines, delimitedStart } from "@zotlit/shared/delimited";
import type { DelimitedFormat } from "@zotlit/shared/delimited";

export type AnswerDocument =
  | { readonly format: "json"; readonly head: string }
  | { readonly format: DelimitedFormat };

export type EmitPiece<E> = (piece: string) => Effect.Effect<void, E>;

export interface AnswerEncoder<E> {
  readonly write: (
    rows: readonly QueryRow[],
    groupIndex?: number,
  ) => Effect.Effect<void, E>;
  readonly end: Effect.Effect<void, E>;
}

type RowState =
  | { readonly _tag: "Start" }
  | { readonly _tag: "Group"; readonly group: number }
  | { readonly _tag: "Rows"; readonly group: number | undefined }
  | { readonly _tag: "End" };

interface RowsFormat {
  readonly start: string;
  group(groupIndex: number, previous: number | undefined): string;
  rows(
    chunk: readonly QueryRow[],
    groupIndex: number | undefined,
    first: boolean,
  ): string;
  end(lastGroup: number | undefined): string;
}

const ANSWER_STEP_BUDGET_MS = SLICE_BUDGET_MS / 2;
const NO_ROWS = "[]\n}";
const CHUNK_START = '{\n  "rows": [';
const CHUNK_END = "\n  ]\n}";
const FIRST_CHUNK_ROWS = 64;
const CHUNK_TEXT_LENGTH = 256 * 1024;

export function encodeAnswer<E>(
  result: QuerySummary,
  document: AnswerDocument,
  options: { emit: EmitPiece<E>; onAnswerStep?: (ms: number) => void },
): Effect.Effect<AnswerEncoder<E>, E> {
  const { emit, onAnswerStep } = options;
  return Effect.gen(function* () {
    const now = monotonicMillis(yield* Clock.Clock);
    const grouped = result.groups !== undefined;
    const rowsFormat =
      document.format === "json"
        ? jsonRows(result, document.head)
        : delimitedRows(result, document.format);
    let state: RowState = { _tag: "Start" };
    let chunkRows = FIRST_CHUNK_ROWS;
    const activeGroup = (): number | undefined =>
      state._tag === "Group" || state._tag === "Rows" ? state.group : undefined;
    yield* emit(rowsFormat.start);
    return {
      write: Effect.fnUntraced(function* (
        rows: readonly QueryRow[],
        groupIndex?: number,
      ) {
        if (grouped && groupIndex !== activeGroup()) {
          yield* emit(rowsFormat.group(groupIndex!, activeGroup()));
          state = { _tag: "Group", group: groupIndex! };
        }
        let stepMs = 0;
        for (let start = 0; start < rows.length;) {
          const stepStart = now();
          const chunk = rows.slice(start, start + chunkRows);
          const part = rowsFormat.rows(
            chunk,
            groupIndex,
            state._tag !== "Rows",
          );
          state = { _tag: "Rows", group: activeGroup() };
          start += chunk.length;
          chunkRows = Math.max(
            1,
            Math.ceil(CHUNK_TEXT_LENGTH / (part.length / chunk.length)),
          );
          stepMs += now() - stepStart;
          yield* emit(part);
          if (stepMs < ANSWER_STEP_BUDGET_MS) continue;
          onAnswerStep?.(stepMs);
          stepMs = 0;
        }
        onAnswerStep?.(stepMs);
      }),
      end: Effect.suspend(() => {
        const piece = rowsFormat.end(activeGroup());
        state = { _tag: "End" };
        return emit(piece);
      }),
    };
  });
}

function jsonRows(result: QuerySummary, head: string): RowsFormat {
  const grouped = result.groups !== undefined;
  return {
    start:
      result.returnedCount === 0 ? head : `${head.slice(0, -NO_ROWS.length)}[`,
    group(groupIndex, previous) {
      const group = result.groups![groupIndex]!;
      const header = JSON.stringify({ ...group, rows: [] }, null, 2);
      return `${previous === undefined ? "" : "\n      ]\n    },"}\n    ${header.slice(0, -NO_ROWS.length).replaceAll("\n", "\n    ")}[`;
    },
    rows(chunk, _groupIndex, first) {
      const wire = JSON.stringify({ rows: chunk }, null, 2).slice(
        CHUNK_START.length,
        -CHUNK_END.length,
      );
      const indented = grouped ? wire.replaceAll("\n", "\n    ") : wire;
      return first ? indented : `,${indented}`;
    },
    end: (lastGroup) =>
      `${lastGroup === undefined ? "" : "\n      ]\n    }"}${result.returnedCount > 0 ? CHUNK_END : ""}`,
  };
}

function delimitedRows(
  result: QuerySummary,
  format: DelimitedFormat,
): RowsFormat {
  const grouped = result.groups !== undefined;
  const { fields } = result.query;
  const header = [...(grouped ? ["group"] : []), "indexedKey", ...fields];
  return {
    start: delimitedStart(format) + delimitedLines([header], format),
    group: () => "",
    rows(chunk, groupIndex) {
      const group = grouped
        ? [valueText(result.groups[groupIndex!]!.value)]
        : [];
      const wire = JSON.parse(JSON.stringify(chunk)) as readonly {
        indexedKey: string;
        values: Readonly<Record<string, ProjectionJson>>;
      }[];
      return delimitedLines(
        wire.map((row) => [
          ...group,
          row.indexedKey,
          ...fields.map((field) => valueText(row.values[field])),
        ]),
        format,
      );
    },
    end: () => "",
  };
}
