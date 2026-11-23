import { clearNotices, cli, obRun } from "@e2e/obsidian-cli.ts";

export async function captureObsidianLayer(
  vaultId: string,
  {
    lesson,
    layer,
    path,
    notice,
  }: {
    lesson: string;
    layer: string;
    path: string;
    notice?: string;
  },
): Promise<void> {
  try {
    if (notice === undefined) await clearNotices(vaultId);
    await obRun(
      vaultId,
      async ({ page }, { notice }) => {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        if (notice === undefined) return;
        await page.until(
          `the notice "${notice}" to be fully in view`,
          () =>
            [...document.querySelectorAll(".notice")].some((element) => {
              if (element.textContent !== notice) return false;
              const { left, top, right, bottom, width, height } =
                element.getBoundingClientRect();
              return (
                width > 0 &&
                height > 0 &&
                left >= 0 &&
                top >= 0 &&
                right <= window.innerWidth &&
                bottom <= window.innerHeight &&
                element.checkVisibility({
                  opacityProperty: true,
                  visibilityProperty: true,
                })
              );
            }),
          2000,
        );
      },
      { notice },
    );
    await cli([`vault=${vaultId}`, "dev:screenshot", `path=${path}`]);
  } catch (error) {
    throw new Error(
      `Could not capture layer "${layer}" of lesson "${lesson}"`,
      {
        cause: error,
      },
    );
  }
}
