# Coding standards

Review-only policy index for packages/db. Load these during standards review. Apply the root standards too; local exceptions have the scope stated below. Keep implementation context in `AGENTS.md`.

Record each meaningful agent mistake in the relevant policy on its first occurrence, through `/retro`
or a direct edit. State the expected behavior and what the reviewer must check.

## Policies

- [Zotero integer domains](policies/integer-domains.md)
- [Query authoring](policies/query-authoring.md)

## Logging

Log through `logLibrary` from `@zotlit/shared/logging`, with a category rooted at `["zotlit", "db", ...]` — libraries stay app-agnostic, and the host that runs them installs the sink (`policies/logging.md`).

```ts
import { logLibrary } from "@zotlit/shared/logging";
logLibrary({
  level: "warn",
  category: ["zotlit", "db", "tags"],
  message: "Unknown tag type {type}",
  properties: { type },
});
```
