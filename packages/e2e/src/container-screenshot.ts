import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  listObsidianWindows,
  openCdpSession,
} from "@zotlit/scripts/obsidian-cdp";

export async function captureContainerWindows(
  evidenceDir: string,
  testId: string,
): Promise<void> {
  const windows = await listObsidianWindows();
  const folder = join(evidenceDir, "screenshots");
  await mkdir(folder, { recursive: true });
  await Promise.all(
    windows
      .filter(({ kind }) => kind !== "silent")
      .map(async ({ id, webSocketDebuggerUrl }) => {
        using cdp = await openCdpSession(webSocketDebuggerUrl);
        const { data } = await cdp.send(
          "Page.captureScreenshot",
          {
            format: "png",
          },
          { timeoutMs: 3_000 },
        );
        if (typeof data !== "string")
          throw new Error(`No capture for window ${id}`);
        await writeFile(
          join(folder, `failure-${testId}-${id}.png`),
          Buffer.from(data, "base64"),
        );
      }),
  );
}
