import { parsePackPins } from "@zotlit/resource-pack/pins.ts";

import resources from "../../../resources/package.json" with { type: "json" };

export const SQLITE_ENGINE_PIN = parsePackPins(resources)["sqlite-engine"]!.version;
