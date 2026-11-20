import { Plugin } from "obsidian";

import type { PdfReaderRegistration } from "@zotlit/pdf-reader/obsidian";
import { registerPdfReader } from "@zotlit/pdf-reader/obsidian";
import type {
  ReaderApi,
  ReaderExtension,
  ReaderPage,
  RefuseReason,
} from "@zotlit/reader-api";
import { connectReader, READER_API } from "@zotlit/reader-api";

const PROBE_VIEW_TYPE = "probe-pdf";
const PROBE_LAYER = "probe-band";

export interface ProbeData {
  readonly major?: number;
  readonly host?: boolean;
}

type ProbeConnection =
  | { readonly state: "connected"; readonly api: ReaderApi }
  | { readonly state: "refused"; readonly reason: RefuseReason }
  | { readonly state: "absent" };

export default class ReaderProbePlugin extends Plugin {
  pdf: PdfReaderRegistration | null = null;
  connection: ProbeConnection | null = null;
  drawn = 0;
  readonly attached: {
    readonly kind: string;
    readonly subpath: string | null;
    readonly restored: boolean;
  }[] = [];

  readonly extension: ReaderExtension = {
    id: PROBE_LAYER,
    kinds: ["view", "embed", "hover", "canvas"],
    attach: ({ reader, host, subpath }) => {
      this.attached.push({
        kind: host.kind,
        subpath: subpath?.raw ?? null,
        restored: host.restored,
      });
      for (const page of reader.renderedPages()) this.draw(page);
      const off = reader.on("page-rendered", ({ page }) => this.draw(page));
      return { [Symbol.dispose]: off };
    },
  };

  draw(page: ReaderPage): void {
    this.drawn++;
    const layer = page.layer(PROBE_LAYER);
    const band = layer.ownerDocument.createElement("div");
    band.className = "probe-band";
    const box = page.toBox([0, 380, 612, 400]);
    band.style.setProperty("--probe-left", box.left);
    band.style.setProperty("--probe-top", box.top);
    band.style.setProperty("--probe-width", box.width);
    band.style.setProperty("--probe-height", box.height);
    layer.replaceChildren(band);
  }

  override async onload(): Promise<void> {
    const data = ((await this.loadData()) ?? {}) as ProbeData;
    if (data.host)
      this.pdf = registerPdfReader(this, {
        viewType: PROBE_VIEW_TYPE,
        displayName: "Probe PDF",
        extensions: [this.extension],
      });
    this.register(
      connectReader(
        this.app.workspace,
        {
          client: this.manifest.id,
          major: data.major ?? READER_API.major,
          minor: READER_API.minor,
        },
        {
          onAccept: (api) => {
            this.connection = { state: "connected", api };
            this.register(api.addExtension(this.extension));
          },
          onRefuse: (reason) => {
            this.connection = { state: "refused", reason };
          },
          onAbsent: () => {
            this.connection = { state: "absent" };
          },
        },
      ),
    );
  }
}
