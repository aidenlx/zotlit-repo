import type { ResourcePackHostPorts } from "#obsidian/managed-binary/pack-platform.ts";
import { Layer } from "effect";

import {
  inProcessClient,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import { layerRcRef } from "@zotlit/zotero-reads/worker/connection.ts";
import type { HandlersOptions } from "@zotlit/zotero-reads/worker/handlers.ts";
import { readSegmenterOver } from "@zotlit/zotero-reads/worker/segmenter.ts";

import { layerChineseSegmenter } from "./service.ts";
import type { ChineseSegmenter } from "./service.ts";

import { layerPackDevice } from "#obsidian/managed-binary/__fixtures__.ts";

export const segmenterHandlers = (
  device: ResourcePackHostPorts,
): Pick<HandlersOptions, "readSegmenter"> => ({
  readSegmenter: readSegmenterOver((url) => device.open(url)),
});

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
