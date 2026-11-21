import type { ResourcePackHostPorts } from "#obsidian/managed-binary/pack-platform.ts";
// The Chinese Segmenter over a fake device and an in-process ZoteroReads worker.
import { Layer } from "effect";

import {
  inProcessClient,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";
import type { HandlersOptions } from "@zotlit/zotero-reads/worker/handlers.ts";

import { layerChineseSegmenter } from "./service.ts";
import type { ChineseSegmenter } from "./service.ts";

import { readSegmenterOver } from "#core/chinese-segmenter/pack-reader.ts";
import { layerPackDevice } from "#obsidian/managed-binary/__fixtures__.ts";

/** The handler options of a worker that reads the Segmenter from the pack of `device`. */
export const segmenterHandlers = (
  device: ResourcePackHostPorts,
): Pick<HandlersOptions, "readSegmenter"> => ({
  readSegmenter: readSegmenterOver((url) => device.open(url)),
});

/**
 * The Chinese Segmenter on `device`, over `reads`: by default an in-process
 * worker on an empty database that reads the pack of the device.
 */
export const layerDeviceSegmenter = (
  device: ResourcePackHostPorts,
  reads: Layer.Layer<ZoteroReads> = layerZoteroReads(
    inProcessClient(
      layerRcRef(memoryOpener(() => "").open),
      segmenterHandlers(device),
    ),
  ),
): Layer.Layer<ChineseSegmenter> =>
  layerChineseSegmenter.pipe(Layer.provide([layerPackDevice(device), reads]));
