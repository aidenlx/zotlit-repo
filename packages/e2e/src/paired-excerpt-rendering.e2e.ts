import { describe, expect, it, beforeAll } from "vitest";

import {
  verifyExcerptRendering,
  verifyZoteroExcerptParity,
} from "./excerpt-rendering.ts";
import {
  baseUrl,
  debuggerPort,
  registerPairedRun,
  vaultId,
  restorePairedFixture,
} from "./paired-run-fixture.ts";
import { openZoteroRdp } from "./paired-zotero.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  beforeAll(restorePairedFixture, 120000);

  describe.skipIf(!debuggerPort || !vaultId)(
    "excerpt rendering with readers closed",
    () => {
      it("renders the deterministic matrix with Zotero open and no reader", async () => {
        using rdp = await openZoteroRdp(debuggerPort!);
        expect(await rdp.json<number>("Zotero.Reader._readers.length")).toBe(0);
        await verifyExcerptRendering(vaultId!);
        await verifyZoteroExcerptParity(vaultId!);
        expect(await rdp.json<number>("Zotero.Reader._readers.length")).toBe(0);
      }, 120000);
    },
  );
});
