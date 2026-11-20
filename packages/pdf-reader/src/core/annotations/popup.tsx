/** @jsxImportSource preact */
import type { ReaderHost } from "#/core/host.ts";
import type { PageBox } from "#/core/types.ts";
import type { JSX } from "preact";
import { render } from "preact";
import { useState } from "preact/hooks";

import { HostIcon } from "#/core/chrome/controls.tsx";

export interface PopupContent {
  readonly id: string;
  readonly contents: string;
  readonly title: string;
  readonly date: string | null;
  readonly copyText: string;
}

function Popup(props: {
  readonly host: ReaderHost;
  readonly content: PopupContent;
  readonly box: PageBox;
}): JSX.Element {
  const { host, content, box } = props;
  const [copied, setCopied] = useState(false);
  return (
    <div
      data-zpr-part="annotation-popup"
      data-annotation-id={content.id}
      style={{
        "--zpr-popup-left": `calc(${box.left} + ${box.width} / 2)`,
        "--zpr-popup-top": `calc(${box.top} + ${box.height})`,
      }}
      className="zpr:pointer-events-auto zpr:absolute zpr:left-(--zpr-popup-left) zpr:top-(--zpr-popup-top) zpr:z-30 zpr:mt-2 zpr:flex zpr:w-(--zpr-popup-width) zpr:-translate-x-1/2 zpr:flex-col zpr:gap-1 zpr:rounded-md zpr:border zpr:border-border zpr:bg-popup zpr:p-3 zpr:text-sm zpr:text-foreground zpr:shadow-md"
    >
      {content.contents && (
        <p
          data-zpr-part="annotation-contents"
          className="zpr:whitespace-pre-wrap zpr:break-words"
        >
          {content.contents}
        </p>
      )}
      <div className="zpr:flex zpr:items-center zpr:gap-2 zpr:text-xs zpr:text-muted">
        <span className="zpr:min-w-0 zpr:flex-1 zpr:truncate">
          {[content.title, content.date].filter(Boolean).join(" · ")}
        </span>
        <button
          type="button"
          data-zpr-control=""
          data-zpr-part="annotation-copy"
          aria-label={host.t("pdf_reader_copy_annotation")}
          className="zpr:inline-flex zpr:rounded-icon zpr:p-1 zpr:text-icon zpr:cursor-(--cursor,default) zpr:hover:bg-hover zpr:hover:text-icon-hover"
          onClick={() => {
            void host.copy(content.copyText).then(() => setCopied(true));
          }}
        >
          <HostIcon
            host={host}
            name={copied ? "lucide-check" : "lucide-copy"}
          />
        </button>
      </div>
    </div>
  );
}

export function showPopup(
  layer: HTMLElement,
  popup: {
    readonly host: ReaderHost;
    readonly content: PopupContent;
    readonly box: PageBox;
  },
): Disposable & { readonly element: Element } {
  const { host, content, box } = popup;
  const container = layer.ownerDocument.createElement("div");
  layer.append(container);
  render(<Popup host={host} content={content} box={box} />, container);
  return {
    element: container.firstElementChild ?? container,
    [Symbol.dispose]: () => {
      render(null, container);
      container.remove();
    },
  };
}
