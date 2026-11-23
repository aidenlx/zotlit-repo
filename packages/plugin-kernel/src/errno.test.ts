import { it } from "@effect/vitest";
import { Effect } from "effect";
import { expect } from "vitest";

import { nodeFileSystemCall } from "./errno.ts";

for (const code of ["EACCES", "EPERM"]) {
  it.effect(
    `maps ${code} to PermissionDenied and keeps the original error`,
    () =>
      Effect.gen(function* () {
        const cause = Object.assign(new Error("Could not open file"), { code });
        const error = yield* Effect.flip(
          nodeFileSystemCall("open", "attachment.pdf", () =>
            Promise.reject(cause),
          ),
        );

        expect(error.reason._tag).toBe("PermissionDenied");
        expect(error.cause).toBe(cause);
      }),
  );
}
