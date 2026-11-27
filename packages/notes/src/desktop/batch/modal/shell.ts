import type { BatchFailure } from "#obsidian/batch/batch-run.ts";
import { Effect } from "effect";
import type { App } from "obsidian";
import { ButtonComponent, Modal, setIcon } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { failureRow, ICON_CLS, section, SECTION_SUMMARY_CLS } from "./dom.ts";
import type {
  BatchManifest,
  BatchModalOptions,
  BatchRunResult,
} from "./types.ts";

import { makeStopRequest } from "#obsidian/batch/batch-run.ts";

export class BatchModal extends Modal {
  readonly #options: BatchModalOptions;
  #manifest: BatchManifest | null = null;
  #classifyAbort: AbortController | null = null;
  #stopRun: (() => void) | null = null;
  #dismissed = false;
  #choosingProfile = false;

  readonly #finalStatus = new Map<number, "done" | "skipped" | "failed">();
  #barFill: HTMLElement | null = null;
  #countEl: HTMLElement | null = null;
  #failedEl: HTMLElement | null = null;
  #failedPanel: HTMLElement | null = null;
  #failedPanelSummary: HTMLElement | null = null;
  #failedPanelList: HTMLElement | null = null;
  readonly #failures: BatchFailure[] = [];

  constructor(app: App, options: BatchModalOptions) {
    super(app);
    this.#options = options;
  }

  override onOpen(): void {
    this.setTitle(this.#options.text.title);
    this.modalEl.addClass("mod-scrollable-content");
    this.contentEl.addClass("zt-root");
    void this.#classify();
  }

  override onClose(): void {
    this.#dismissed = true;
    this.#classifyAbort?.abort();
    this.#stopRun?.();
    this.contentEl.empty();
  }

  get #manifestOrThrow(): BatchManifest {
    if (!this.#manifest) throw new Error("manifest not classified yet");
    return this.#manifest;
  }

  async #classify(): Promise<void> {
    this.#renderLoading();
    const abort = new AbortController();
    this.#classifyAbort = abort;

    let manifest: BatchManifest;
    try {
      manifest = await this.#options.onClassify({
        onProgress: (classified) =>
          this.#setBar(classified, this.#options.total),
        signal: abort.signal,
      });
    } catch {
      if (!this.#dismissed) {
        new BaseNotice(this.#options.text.loadFailed);
        this.close();
      }
      return;
    } finally {
      this.#classifyAbort = null;
    }

    if (this.#dismissed) return;
    this.#manifest = manifest;
    this.#renderConfirm();
  }

  #renderShell(): HTMLElement {
    const { contentEl } = this;
    contentEl.empty();
    return contentEl.createDiv({ cls: "zt:flex zt:flex-col zt:h-[60vh]" });
  }

  #renderFooter(): HTMLElement {
    this.modalEl.querySelector(":scope > .modal-button-container")?.remove();
    return this.modalEl.createDiv({ cls: "modal-button-container zt-root" });
  }

  #button(footer: HTMLElement, text: string, onClick: () => void) {
    return new ButtonComponent(footer).setButtonText(text).onClick(onClick);
  }

  #renderConfirm(): void {
    const manifest = this.#manifestOrThrow;
    const shell = this.#renderShell();
    shell.createEl("p", {
      text: this.#options.text.confirmIntro(manifest.counts),
      cls: "zt:shrink-0 zt:mb-3 zt:text-(--text-normal)",
    });
    const body = shell.createDiv({
      cls: "zt:flex-1 zt:min-h-0 zt:overflow-y-auto",
    });
    let runButton: ButtonComponent | undefined;
    manifest.renderList(body, {
      chooseProfile: async (choice) => {
        if (this.#choosingProfile || this.#dismissed) return;
        this.#choosingProfile = true;
        runButton?.setDisabled(true);
        try {
          await choice.choose();
        } catch (error) {
          Effect.runSyncWith(logServices)(
            Effect.logError("Failed to change batch Profile").pipe(
              Effect.annotateLogs({
                error,
                label: choice.label,
                source: choice.source,
              }),
              withLogCategory("batch-modal"),
            ),
          );
          if (!this.#dismissed) new BaseNotice(this.#options.text.loadFailed);
        } finally {
          this.#choosingProfile = false;
          if (!this.#dismissed) this.#renderConfirm();
        }
      },
    });

    const footer = this.#renderFooter();
    if (manifest.counts.actionable > 0)
      runButton = this.#button(
        footer,
        this.#options.text.confirmButton,
        () => void this.#run(),
      ).setCta();
    this.#button(footer, m.modal_cancel(), () => this.close());
  }

  #renderLoading(): void {
    const shell = this.#renderShell();
    const headline = this.#renderBarHeadline(
      shell,
      this.#options.text.loadingLabel,
      false,
    );
    this.#countEl = headline.createDiv({
      cls: "zt:text-sm zt:tabular-nums zt:text-(--text-muted)",
    });
    this.#setBar(0, this.#options.total);

    this.#button(this.#renderFooter(), m.modal_cancel(), () => this.close());
  }

  #renderProgress(): void {
    const shell = this.#renderShell();
    const headline = this.#renderBarHeadline(
      shell,
      this.#options.text.progressLabel,
    );
    const counts = headline.createDiv({
      cls: "zt:flex zt:gap-3 zt:text-sm zt:tabular-nums zt:text-(--text-muted)",
    });
    this.#countEl = counts.createSpan();
    this.#failedEl = counts.createSpan({ cls: "zt:text-(--text-error)" });
    this.#updateProgress();

    const warning = shell.createDiv({
      cls: "zt:shrink-0 zt:flex zt:items-center zt:gap-2 zt:mb-2 zt:text-xs zt:text-(--text-warning)",
    });
    setIcon(warning.createSpan({ cls: ICON_CLS }), "triangle-alert");
    warning.createSpan({
      text:
        this.#options.text.progressWarning ?? m.batch_update_progress_warning(),
    });

    this.#renderFailedPanel(shell);
    this.#manifestOrThrow.renderList(this.#renderDisclosure(shell, false));

    const cancel = this.#button(this.#renderFooter(), m.modal_cancel(), () => {
      this.#stopRun?.();
      cancel
        .setButtonText(
          this.#options.text.cancelling ?? m.batch_update_cancelling(),
        )
        .setDisabled(true);
    });
  }

  #renderFailedPanel(parent: HTMLElement): void {
    const details = parent.createEl("details", {
      cls: "zt:shrink-0 zt:mb-2 zt:max-h-32 zt:overflow-y-auto",
      attr: { open: "" },
    });
    details.toggle(false);
    this.#failedPanel = details;
    this.#failedPanelSummary = details.createEl("summary", {
      cls: cn(SECTION_SUMMARY_CLS, "zt:text-(--text-error)"),
    });
    this.#failedPanelList = details.createEl("ul", {
      cls: "zt:m-0 zt:list-none zt:p-0",
    });
  }

  #addFailure(failure: BatchFailure): void {
    this.#failures.push(failure);
    if (!this.#failedPanel || !this.#failedPanelList) return;
    failureRow(this.#failedPanelList, failure, this.app);
    this.#failedPanel.toggle(true);
    this.#failedPanelSummary?.setText(
      (this.#options.text.failedHeader ?? m.batch_update_group_failed)({
        count: this.#failures.length,
      }),
    );
  }

  #renderBarHeadline(
    shell: HTMLElement,
    label: string,
    animate = true,
  ): HTMLElement {
    const headline = shell.createDiv({
      cls: "zt:shrink-0 zt:flex zt:flex-col zt:gap-2 zt:py-2",
    });
    headline.createEl("p", {
      text: label,
      cls: "zt:m-0 zt:text-base zt:font-medium zt:text-(--text-normal)",
    });
    const track = headline.createDiv({
      cls: "zt:h-2 zt:w-full zt:rounded-full zt:overflow-hidden zt:bg-(--background-modifier-border)",
    });
    this.#barFill = track.createDiv({
      cls: cn(
        "zt:h-full zt:rounded-full zt:bg-(--interactive-accent)",
        animate && "zt:transition-[width] zt:duration-200",
      ),
    });
    return headline;
  }

  #renderDisclosure(parent: HTMLElement, open: boolean): HTMLElement {
    const details = parent.createEl("details", {
      cls: "zt:flex-1 zt:min-h-0 zt:overflow-y-auto",
      attr: open ? { open: "" } : {},
    });
    const showText =
      this.#options.text.detailsShow ?? m.batch_update_details_show();
    const hideText =
      this.#options.text.detailsHide ?? m.batch_update_details_hide();
    const summary = details.createEl("summary", {
      cls: "zt:cursor-pointer zt:text-sm zt:text-(--text-muted) zt:py-1",
      text: open ? hideText : showText,
    });
    details.addEventListener("toggle", () => {
      summary.setText(details.open ? hideText : showText);
    });
    return details;
  }

  #setBar(done: number, total: number): void {
    const pct = total === 0 ? 100 : Math.round((done / total) * 100);
    if (this.#barFill) this.#barFill.style.width = `${pct}%`;
    this.#countEl?.setText(
      (this.#options.text.progressCount ?? m.batch_update_progress_count)({
        done,
        total,
        pct,
      }),
    );
  }

  #updateProgress(): void {
    const total = this.#manifestOrThrow.counts.actionable;
    const failed = this.#failures.length;
    this.#setBar(this.#finalStatus.size, total);
    if (this.#failedEl) {
      this.#failedEl.toggle(failed > 0);
      if (failed > 0) {
        this.#failedEl.setText(
          (this.#options.text.progressFailed ?? m.batch_update_progress_failed)(
            { count: failed },
          ),
        );
      }
    }
  }

  async #run(): Promise<void> {
    if (this.#choosingProfile || this.#dismissed) return;
    this.#renderProgress();
    const { stop, request } = makeStopRequest();
    this.#stopRun = request;

    let result: BatchRunResult;
    try {
      result = await this.#options.onRun({
        onItemSettled: (event) => {
          this.#finalStatus.set(event.id, event.status);
          this.#manifestOrThrow.setRowStatus(event.id, event.status);
          if (event.status === "failed") this.#addFailure(event.failure);
          this.#updateProgress();
        },
        stop,
      });
    } catch (error) {
      if (!this.#dismissed) {
        const { runFailed } = this.#options.text;
        new BaseNotice(
          typeof runFailed === "function" ? runFailed(error) : runFailed,
        );
        this.close();
      }
      return;
    } finally {
      this.#stopRun = null;
    }

    if (this.#dismissed) {
      new BaseNotice(
        this.#options.text.runSummary(result, {
          cancelled: result.cancelled,
          aborted: true,
        }),
      );
      return;
    }

    const summary = this.#options.text.runSummary(result, {
      cancelled: result.cancelled,
      aborted: false,
    });
    new BaseNotice(summary);
    this.#renderSummary(summary);
  }

  #renderSummary(summary: string): void {
    this.#failedPanel = null;
    this.#failedPanelSummary = null;
    this.#failedPanelList = null;
    const shell = this.#renderShell();
    shell.createEl("p", {
      text: summary,
      cls: "zt:shrink-0 zt:mb-1 zt:text-base zt:text-(--text-normal)",
    });

    const details = this.#renderDisclosure(shell, this.#failures.length > 0);
    if (this.#failures.length > 0) {
      section(
        details,
        (this.#options.text.failedHeader ?? m.batch_update_group_failed)({
          count: this.#failures.length,
        }),
        {
          items: this.#failures,
          renderRow: (ul, failure) => failureRow(ul, failure, this.app),
          open: true,
        },
      );
    }
    this.#manifestOrThrow.renderSummary(details, this.#finalStatus);

    this.#button(
      this.#renderFooter(),
      this.#options.text.closeButton ?? m.batch_update_close(),
      () => this.close(),
    ).setCta();
  }
}
