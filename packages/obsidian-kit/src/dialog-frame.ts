import type { Modal } from "obsidian";
import { ButtonComponent } from "obsidian";

const WIDE_DIALOG_CLASSES = [
  "zt:[--dialog-width:var(--modal-width)]",
  "zt:[--dialog-max-width:var(--modal-max-width)]",
];

const FIELD_CLASS = "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5";
const FIELD_NAME_CLASS = "zt:text-sm zt:leading-(--line-height-tight)";
const HEADING_CLASS =
  "zt:text-sm zt:leading-(--line-height-tight) zt:font-semibold";
export const NOTE_CLASS =
  "zt:text-xs zt:leading-(--line-height-tight) zt:text-pretty zt:text-muted-foreground";

export function frameDialog(modal: Modal, options: { wide?: boolean } = {}) {
  modal.modalEl.addClass("mod-scrollable-content");
  modal.modalEl.toggleClass(WIDE_DIALOG_CLASSES, options.wide ?? false);
  modal.contentEl.addClass("zt-root");
}

export function dialogFooter(modal: Modal): HTMLElement {
  modal.modalEl.querySelector(":scope > .modal-button-container")?.remove();
  return modal.modalEl.createDiv({ cls: "modal-button-container zt-root" });
}

export function footerButton(
  footer: HTMLElement,
  text: string,
  onClick: () => unknown,
): ButtonComponent {
  return new ButtonComponent(footer).setButtonText(text).onClick(onClick);
}

export function twoColumns(contentEl: HTMLElement): {
  controls: HTMLElement;
  preview: HTMLElement;
} {
  const layout = contentEl.createDiv({
    cls: "zt:grid zt:grid-cols-1 zt:gap-6 zt:md:grid-cols-2",
  });
  return {
    controls: layout.createDiv({
      cls: "zt:flex zt:min-w-0 zt:flex-col zt:gap-4",
    }),
    preview: layout.createDiv({ cls: "zt:min-w-0" }),
  };
}

export function heading(parent: HTMLElement, text: string): HTMLElement {
  return parent.createDiv({
    text,
    cls: HEADING_CLASS,
    attr: { role: "heading", "aria-level": "3" },
  });
}

export function field(parent: HTMLElement, name: string): HTMLElement {
  const label = parent.createEl("label", { cls: FIELD_CLASS });
  label.createSpan({ text: name, cls: FIELD_NAME_CLASS });
  return label.createDiv({ cls: "zt:flex zt:min-w-0 zt:*:w-full" });
}

export function note(
  parent: HTMLElement,
  options: { text?: string; status?: boolean } = {},
): { set(text: string, tone?: "muted" | "error"): void } {
  const el = parent.createEl("p", {
    cls: NOTE_CLASS,
    text: options.text ?? "",
    attr: options.status ? { role: "status" } : {},
  });
  return {
    set(text, tone = "muted") {
      el.setText(text);
      el.toggleClass("zt:text-(--text-error)", tone === "error");
      el.toggleClass("zt:text-muted-foreground", tone === "muted");
    },
  };
}
