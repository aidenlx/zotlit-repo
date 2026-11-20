import { Plugin } from "obsidian";

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

  override onload(): void {
    this.pdf = registerPdfReader(this, {
      viewType: PROBE_VIEW_TYPE,
      displayName: "Probe PDF",
      extensions: [
        {
          id: PROBE_LAYER,
          kinds: ["view", "embed", "hover", "canvas"],
          attach: ({ host, subpath }) => {
            this.attached.push({
              kind: host.kind,
              subpath: subpath?.raw ?? null,
              restored: host.restored,
            });
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
}
