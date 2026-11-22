import type { App, EventRef, MetadataTypeManager } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forwardLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { assignedWidget, onTypesChanged } from "./metadata-type-manager.ts";

const warn = vi.hoisted(() => vi.fn());
let forwarding: Disposable;
beforeEach(() => {
  forwarding = forwardLogRecords((record) => {
    if (record.level === "warning") warn(record.rawMessage, record.properties);
  });
});
afterEach(() => forwarding[Symbol.dispose]());

beforeEach(() => warn.mockClear());

function manager(types: Record<string, string>) {
  const listeners = new Set<(name: string) => void>();
  return {
    getAssignedWidget: (name: string) => {
      const found = Object.entries(types).find(
        ([key]) => key.toLowerCase() === name.toLowerCase(),
      );
      return found ? found[1] : null;
    },
    on: vi.fn((_event: "changed", cb: (name: string) => void) => {
      listeners.add(cb);
      const ref = { cb };
      return ref;
    }),
    offref: vi.fn((eventRef: EventRef) => {
      const callback = (eventRef as unknown as { cb?: (name: string) => void })
        .cb;
      if (callback) listeners.delete(callback);
    }),
    setType(name: string, widget: string) {
      types[name] = widget;
      for (const cb of listeners) cb(name.toLowerCase());
    },
  };
}

describe("assignedWidget", () => {
  it("reads the type assigned to a property, whatever its case", () => {
    const app = stubService<App>("App", {
      metadataTypeManager: manager({ Pages: "number" }),
    });

    expect(assignedWidget(app, "pages")).toBe("number");
    expect(assignedWidget(app, "status")).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads no type, and warns once, when the app has no type manager", () => {
    const app = stubService<App>("App", { metadataTypeManager: undefined });

    expect(assignedWidget(app, "pages")).toBeNull();
    expect(assignedWidget(app, "status")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("reads no type when the manager lost its read", () => {
    const { on, offref } = manager({});
    const app = stubService<App>("App", {
      metadataTypeManager: {
        on,
        offref,
      } satisfies Partial<MetadataTypeManager>,
    });

    expect(assignedWidget(app, "pages")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("onTypesChanged", () => {
  it("runs the callback on each change of an assigned type, until the returned callback stops it", () => {
    const types = manager({});
    const app = stubService<App>("App", { metadataTypeManager: types });
    const listener = vi.fn();

    const off = onTypesChanged(app, listener);
    types.setType("pages", "number");
    off();
    types.setType("pages", "text");

    expect(listener).toHaveBeenCalledOnce();
    expect(types.offref).toHaveBeenCalledOnce();
  });

  it("does nothing when the app has no type manager", () => {
    const off = onTypesChanged(
      stubService<App>("App", { metadataTypeManager: undefined }),
      vi.fn(),
    );

    expect(() => off()).not.toThrow();
  });
});
