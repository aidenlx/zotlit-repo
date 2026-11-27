import { describe, expect, it } from "vitest";

import { remoteCacheAuthFailed } from "./gate-output.ts";

describe("remoteCacheAuthFailed", () => {
  it("reads the warnings Turbo prints when its Remote Cache sign-in fails", () => {
    expect(
      remoteCacheAuthFailed(
        " WARNING  Failed to refresh stored Vercel auth token: token refresh failed with HTTP 400",
      ),
    ).toBe(true);
    expect(
      remoteCacheAuthFailed(
        " WARNING  Remote cache returned 403 for a read and access could not be restored; disabling remote cache reads and uploads for this run",
      ),
    ).toBe(true);
  });

  it("passes the lines of a run that reads the Remote Cache", () => {
    expect(
      remoteCacheAuthFailed(
        "   • Remote caching enabled, using shared worktree cache",
      ),
    ).toBe(false);
    expect(
      remoteCacheAuthFailed("@zotlit/db:test: cache hit, suppressing logs 1f"),
    ).toBe(false);
  });
});
