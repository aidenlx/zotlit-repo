/** @jsxImportSource preact */
import type { ChromeModel } from "#/core/chrome/model.ts";
import type { ReaderSlot } from "#/core/types.ts";
import { RegistryContext } from "@effect/atom-react";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import type { ComponentChildren, PreactContext } from "preact";
import { Component, render } from "preact";

import { FindBar } from "./find-bar.tsx";
import { Overlays } from "./overlays.tsx";
import { Sidebar } from "./sidebar.tsx";
import { Toolbar } from "./toolbar.tsx";

import { ChromeContext } from "#/core/chrome/model.ts";

export interface ChromeElements {
  readonly slots: Readonly<Record<ReaderSlot, HTMLElement>>;
  readonly scroller: HTMLDivElement;
  readonly viewer: HTMLDivElement;
  focusFind(): void;
}

const RegistryProvider =
  RegistryContext.Provider as unknown as PreactContext<AtomRegistry.AtomRegistry>["Provider"];

class Frozen extends Component<{ readonly children: ComponentChildren }> {
  override shouldComponentUpdate(): boolean {
    return false;
  }

  override render(): ComponentChildren {
    return this.props.children;
  }
}

export function renderChrome(
  root: HTMLElement,
  model: ChromeModel,
): ChromeElements & Disposable {
  const found: {
    "toolbar-start"?: HTMLElement;
    "toolbar-end"?: HTMLElement;
    scroller?: HTMLDivElement;
    viewer?: HTMLDivElement;
  } = {};
  render(
    <RegistryProvider value={model.registry}>
      <ChromeContext.Provider value={model}>
        <Toolbar
          start={
            <Frozen key="toolbar-start">
              <div
                data-zpr-slot="toolbar-start"
                className="zpr:contents"
                ref={(element) => {
                  if (element) found["toolbar-start"] = element;
                }}
              />
            </Frozen>
          }
          end={
            <Frozen key="toolbar-end">
              <div
                data-zpr-slot="toolbar-end"
                className="zpr:contents"
                ref={(element) => {
                  if (element) found["toolbar-end"] = element;
                }}
              />
            </Frozen>
          }
        />
        <div
          data-zpr-part="content"
          className="zpr:relative zpr:flex zpr:min-h-0 zpr:flex-1"
        >
          <Sidebar />
          <div
            data-zpr-part="main"
            className="zpr:relative zpr:flex zpr:min-w-0 zpr:flex-1 zpr:flex-col"
          >
            <FindBar />
            <div
              data-zpr-part="viewport"
              className="zpr:relative zpr:min-h-0 zpr:flex-1"
            >
              <Frozen key="scroller">
                <div
                  data-zpr-part="scroller"
                  tabIndex={-1}
                  style={{ position: "absolute" }}
                  className="zpr:absolute zpr:inset-0 zpr:overflow-auto zpr:bg-background zpr:outline-none"
                  ref={(element) => {
                    if (element) found.scroller = element;
                  }}
                >
                  <div
                    className="pdfViewer"
                    ref={(element) => {
                      if (element) found.viewer = element;
                    }}
                  />
                </div>
              </Frozen>
              <Overlays />
            </div>
          </div>
        </div>
      </ChromeContext.Provider>
    </RegistryProvider>,
    root,
  );
  const { scroller, viewer } = found;
  const start = found["toolbar-start"];
  const end = found["toolbar-end"];
  if (!scroller || !viewer || !start || !end) {
    throw new Error("The reader chrome did not render its elements");
  }
  return {
    slots: { "toolbar-start": start, "toolbar-end": end },
    scroller,
    viewer,
    focusFind: () => {
      const input = model.findInput.current;
      if (!input) return;
      input.focus();
      input.select();
    },
    [Symbol.dispose]: () => {
      render(null, root);
    },
  };
}
