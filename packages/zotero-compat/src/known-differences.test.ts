import { describe, expect, it } from "vitest";

import { annotationValue } from "./annotation.ts";
import { attachmentLastRead, attachmentPath } from "./attachment.ts";
import type { Port, Value } from "./known-differences.ts";
import { KNOWN_DIFFERENCES } from "./known-differences.ts";
import { strToMultipart } from "./multipart-date.ts";
import { noteToTitle } from "./note.ts";
import { isoToSql } from "./sql-date.ts";

const PORTS: Readonly<Record<Port, (...args: never[]) => Value>> = {
  annotationValue,
  attachmentLastRead,
  attachmentPath,
  isoToSql,
  noteToTitle,
  strToMultipart,
};

describe("the known differences from the client", () => {
  it.each(KNOWN_DIFFERENCES.map((row) => [row.port, row.args, row] as const))(
    "%s(%j) gives the accepted result, which differs from the client's",
    (port, args, row) => {
      expect(row.result).not.toEqual(row.client);
      expect(
        (PORTS[port] as (...input: readonly unknown[]) => Value)(...args),
      ).toEqual(row.result);
    },
  );
});
