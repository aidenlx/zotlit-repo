import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";

import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export class DetailsToggle {
  readonly #root: Root;
  readonly #toggle: () => void;

  constructor(el: HTMLElement, toggle: () => void) {
    this.#root = createRoot(el);
    this.#toggle = toggle;
  }

  show(on: boolean): void {
    this.#root.render(
      <IconButton
        icon="panel-right"
        data-library-details-toggle=""
        pressed={on}
        {...tooltipAttrs(m.library_view_details_toggle())}
        onClick={this.#toggle}
      />,
    );
  }

  unmount(): void {
    this.#root.unmount();
  }
}
