import { describe, expect, it } from "vitest";

import { itemUri, itemWebUrl } from "./zt-uri.ts";

describe("itemWebUrl", () => {
  it("uses the groups URL when a groupID is present", () => {
    expect(itemWebUrl("ABC12345", 42, "sample-reader")).toBe(
      "https://www.zotero.org/groups/42/items/ABC12345",
    );
  });

  it("uses the groups URL even when username is null", () => {
    expect(itemWebUrl("ABC12345", 42, null)).toBe(
      "https://www.zotero.org/groups/42/items/ABC12345",
    );
  });

  it("uses the username slug URL for a personal item with a known username", () => {
    expect(itemWebUrl("ABC12345", null, "sample-reader")).toBe(
      "https://www.zotero.org/sample-reader/items/ABC12345",
    );
  });

  it("returns null for a personal item with no username", () => {
    expect(itemWebUrl("ABC12345", null, null)).toBeNull();
  });

  it("slugifies the username: spaces to underscores", () => {
    expect(itemWebUrl("ABC12345", null, "Aiden LX")).toBe(
      "https://www.zotero.org/aiden_lx/items/ABC12345",
    );
  });

  it("slugifies the username: strips chars outside [a-z0-9 ._-]", () => {
    expect(itemWebUrl("ABC12345", null, "user@name!")).toBe(
      "https://www.zotero.org/username/items/ABC12345",
    );
  });
});

describe("itemUri", () => {
  const synced = {
    userID: 654321,
    localUserKey: "XmplKey8",
    username: "sample-reader",
  };
  const local = { userID: null, localUserKey: "XmplKey8", username: null };

  it("uses the numeric account id once the account has synced", () => {
    expect(itemUri("ABC12345", null, synced)).toBe(
      "http://zotero.org/users/654321/items/ABC12345",
    );
  });

  it("uses the local key for a never-synced account", () => {
    expect(itemUri("ABC12345", null, local)).toBe(
      "http://zotero.org/users/local/XmplKey8/items/ABC12345",
    );
  });

  it("uses the groupID for a group item, whatever the account identity", () => {
    expect(itemUri("ABC12345", 42, synced)).toBe(
      "http://zotero.org/groups/42/items/ABC12345",
    );
    expect(
      itemUri("ABC12345", 42, {
        userID: null,
        localUserKey: null,
      }),
    ).toBe("http://zotero.org/groups/42/items/ABC12345");
  });

  it("returns null for a personal item on an account carrying neither id", () => {
    expect(
      itemUri("ABC12345", null, {
        userID: null,
        localUserKey: null,
      }),
    ).toBeNull();
  });
});
