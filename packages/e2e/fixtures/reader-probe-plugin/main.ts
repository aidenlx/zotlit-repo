import type { Component } from "obsidian";
import { MarkdownRenderer, Plugin } from "obsidian";

import type { PdfReaderRegistration } from "@zotlit/pdf-reader/obsidian";
import { registerPdfReader } from "@zotlit/pdf-reader/obsidian";

const PROBE_VIEW_TYPE = "probe-pdf";
const PROBE_LAYER = "probe-band";

export default class ReaderProbePlugin extends Plugin {
  pdf: PdfReaderRegistration | null = null;
  drawn = 0;
  readonly attached: {
    readonly kind: string;
    readonly subpath: string | null;
    readonly restored: boolean;
  }[] = [];
  readonly migrated: { readonly kind: string; readonly window: Window }[] = [];

  override onload(): void {
    this.pdf = registerPdfReader(this, {
      viewType: PROBE_VIEW_TYPE,
      displayName: "Probe PDF",
      extensions: [
        {
          id: PROBE_LAYER,
          kinds: ["view", "embed", "hover", "canvas"],
          attach: ({ host, subpath, reader }) => {
            this.attached.push({
              kind: host.kind,
              subpath: subpath?.raw ?? null,
              restored: host.restored,
            });
            return {
              [Symbol.dispose]: reader.on("window-migrated", ({ window }) => {
                this.migrated.push({ kind: host.kind, window });
              }),
            };
          },
          drawPage: (page, layer) => {
            this.drawn++;
            const band = layer.ownerDocument.createElement("div");
            band.className = "probe-band";
            const box = page.toBox([0, 380, 612, 400]);
            band.style.setProperty("--probe-left", box.left);
            band.style.setProperty("--probe-top", box.top);
            band.style.setProperty("--probe-width", box.width);
            band.style.setProperty("--probe-height", box.height);
            layer.replaceChildren(band);
          },
        },
      ],
    });
  }

  render(target: {
    readonly markdown: string;
    readonly element: HTMLElement;
    readonly sourcePath: string;
    readonly component: Component;
  }): Promise<void> {
    return MarkdownRenderer.render(
      this.app,
      target.markdown,
      target.element,
      target.sourcePath,
      target.component,
    );
  }
}
