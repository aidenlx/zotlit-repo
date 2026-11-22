import { obRun } from "./obsidian-cli.ts";

export async function leftOpen(vaultId: string): Promise<string[]> {
  return obRun(
    vaultId,
    async ({ app, page }) => {
      const { until } = page;
      const docs = () => [
        document,
        ...(
          app.workspace as import("obsidian").Workspace & {
            floatingSplit: { children: { win: Window }[] };
          }
        ).floatingSplit.children.map((split) => split.win.document),
      ];
      const notices = () =>
        docs().flatMap((doc) => [
          ...doc.querySelectorAll<HTMLElement>(".notice"),
        ]);
      for (const notice of notices()) notice.click();
      await until("notices hide", () => notices().length === 0, 2000);
      const open = () =>
        docs().flatMap((doc) => [
          ...doc.querySelectorAll<HTMLElement>(
            ".menu, .modal-container, .zt-pinned-popover",
          ),
        ]);
      const left = open().map(
        (el) =>
          `${
            el.matches(".zt-pinned-popover")
              ? "popover"
              : el.classList.contains("menu")
                ? "menu"
                : "dialog"
          }: ${el.textContent.trim().slice(0, 60)}`,
      );
      for (const doc of docs()) page.closePopovers(doc);
      await until(
        "menus and dialogs close",
        async () => {
          if (open().length === 0) return true;
          await page.menuReady();
          activeDocument.body.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
          return false;
        },
        5000,
      );
      return left;
    },
    undefined,
  );
}
