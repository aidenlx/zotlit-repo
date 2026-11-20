import type { App, MetadataCache as MetadataCacheApi } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forwardLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { propertyValues, vaultTags } from "./property-values.ts";

const warn = vi.hoisted(() => vi.fn());
let forwarding: Disposable;
beforeEach(() => {
  forwarding = forwardLogRecords((record) => {
    if (record.level === "warning") warn(record.rawMessage, record.properties);
  });
});
afterEach(() => forwarding[Symbol.dispose]());

beforeEach(() => warn.mockClear());

describe("propertyValues", () => {
  it("reads the values the vault holds for a property", () => {
    const getFrontmatterPropertyValuesForKey = vi.fn(() => ["read", "reading"]);
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getFrontmatterPropertyValuesForKey,
      }),
    });

    expect(propertyValues(app, "status")).toEqual(["read", "reading"]);
    expect(getFrontmatterPropertyValuesForKey).toHaveBeenCalledWith("status");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads no values, and warns once, when the cache has no read of them", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getFrontmatterPropertyValuesForKey: undefined,
      }),
    });

    expect(propertyValues(app, "status")).toEqual([]);
    expect(propertyValues(app, "rating")).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("keeps only the text values a broken read returns", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getFrontmatterPropertyValuesForKey: () => ["read", 3, null] as never,
      }),
    });

    expect(propertyValues(app, "status")).toEqual(["read"]);
  });
});

describe("vaultTags", () => {
  it("reads the vault's tags without their #", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getTags: () => ({ "#hci": 2, "#reading/done": 1 }),
      }),
    });

    expect(vaultTags(app)).toEqual(["hci", "reading/done"]);
  });

  it("reads no tags when the cache has no read of them", () => {
    const app = stubService<App>("App", {
      metadataCache: stubService<MetadataCacheApi>("MetadataCache", {
        getTags: undefined,
      }),
    });

    expect(vaultTags(app)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
