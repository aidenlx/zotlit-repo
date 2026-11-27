import { Notice } from "obsidian";

export interface NoticeAction {
  readonly label: string;
  readonly run: () => void;
}

export type NoticeProgress =
  | { readonly value: number; readonly max: number }
  | "indeterminate";

export interface NoticeContent {
  readonly title: string;
  readonly lines?: readonly string[];
  readonly progress?: NoticeProgress;
  readonly actions?: readonly NoticeAction[];
}

export type NoticeMessage = string | NoticeContent;

export function noticeSteps(steps: readonly string[]): string[] {
  return steps.map((step, index) => `${index + 1}. ${step}`);
}

export function noticeList(label: string, items: readonly string[]): string[] {
  return [label, ...items.map((item) => `• ${item}`)];
}

export function noticeText(message: NoticeMessage): string {
  if (typeof message === "string") return message;
  return [message.title, ...(message.lines ?? [])].join("\n");
}

export function loadingNotice(message: NoticeMessage): NoticeContent {
  const content = typeof message === "string" ? { title: message } : message;
  return content.progress ? content : { ...content, progress: "indeterminate" };
}

export class LazyNotice implements Disposable {
  #notice: BaseNotice | null = null;

  setMessage(message: NoticeMessage) {
    if (!this.#notice) {
      this.#notice = new BaseNotice(message, 0);
    } else {
      this.#notice.setMessage(message);
    }
  }

  [Symbol.dispose]() {
    this.#notice?.hide();
  }
}

export function isNoticeContent(message: unknown): message is NoticeContent {
  return typeof message === "object" && message !== null && "title" in message;
}

export class BaseNotice extends Notice {
  constructor(message: NoticeMessage, duration?: number) {
    super(noticeText(message), duration);
    this.#decorate(message);
  }

  override setMessage(message: NoticeMessage | DocumentFragment): this {
    super.setMessage(isNoticeContent(message) ? noticeText(message) : message);
    this.#decorate(message);
    return this;
  }

  #decorate(message: NoticeMessage | DocumentFragment): void {
    const content = isNoticeContent(message) ? message : undefined;
    const progress = content?.progress;
    this.containerEl.toggleClass("is-loading", progress === "indeterminate");
    if (progress !== undefined && progress !== "indeterminate") {
      const bar = this.messageEl.createEl("progress");
      bar.max = progress.max;
      bar.value = progress.value;
    }
    this.buttonContainerEl?.remove();
    this.buttonContainerEl = null;
    for (const action of content?.actions ?? []) {
      this.addButton(action.label, () => action.run());
    }
  }
}
