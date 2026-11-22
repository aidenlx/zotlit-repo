# Coding standards

Review-only policy index for packages/db. Load these during standards review. Apply the root standards too; local exceptions have the scope stated below. Keep implementation context in `AGENTS.md`.

## Policies

- [Zotero integer domains](policies/integer-domains.md)
- [Query authoring](policies/query-authoring.md)
- [Logging](../../policies/logging.md) — this package uses categories rooted at `["zotlit", "db", ...]`; the consuming app installs the sink.
