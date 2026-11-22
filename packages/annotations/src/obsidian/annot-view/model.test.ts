import { describe, expect, it, vi } from "vitest";

import {
  holdAnnotViewModel,
  makeAnnotViewModel,
  pinCurrentItem,
  pinItem,
  setFollowMode,
  unpin,
} from "./model.ts";
import type { AnnotViewState } from "./view-state.ts";

import { makeAnnotHost } from "#__fixtures__/annot-view/host.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";

const ACTIVE_TAB: AnnotViewState = {
  followMode: "active-tab",
  previousMode: "active-tab",
  pinnedItemKey: null,
};

const READER: AnnotViewState = { ...ACTIVE_TAB, followMode: "zotero-reader" };

describe("Follow Mode transitions", () => {
  it("switches the source and forgets a pin it ends", () => {
    const pinned = pinItem("ITEMAAAA")(READER);

    expect(setFollowMode("active-tab")(pinned)).toEqual(ACTIVE_TAB);
  });

  it("leaves the state as it is when the mode is already in force", () => {
    expect(setFollowMode("zotero-reader")(READER)).toBe(READER);
  });

  it("pins an Item and remembers the mode the pin interrupts", () => {
    expect(pinItem("ITEMAAAA")(READER)).toEqual({
      followMode: "pinned",
      previousMode: "zotero-reader",
      pinnedItemKey: "ITEMAAAA",
    });
  });

  it("pins the Item on screen, and changes nothing with none", () => {
    expect(pinCurrentItem("ITEMAAAA")(READER)).toEqual(
      pinItem("ITEMAAAA")(READER),
    );
    expect(pinCurrentItem(null)(READER)).toBe(READER);
  });

  it("returns Unpin to the mode the pin interrupted", () => {
    expect(unpin(pinItem("ITEMAAAA")(READER))).toEqual(READER);
  });
});

describe("the Annotation View model", () => {
  it("keeps its state in the registry while it is held", async () => {
    await using host = makeAnnotHost(layerUnreadViewServices);
    const { registry } = host;
    const held = makeAnnotViewModel();
    const unheld = makeAnnotViewModel();
    const release = holdAnnotViewModel(registry, held);

    registry.update(held.state, pinItem("ITEMAAAA"));
    registry.update(unheld.state, pinItem("ITEMAAAA"));
    await vi.waitFor(() =>
      expect(registry.getNodes().has(unheld.cards)).toBe(false),
    );
    expect(registry.get(unheld.state).pinnedItemKey).toBeNull();

    expect(registry.get(held.state).pinnedItemKey).toBe("ITEMAAAA");
    release();
  });
});
