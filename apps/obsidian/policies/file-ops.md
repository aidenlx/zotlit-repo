# File operations

Don't `stat`/`exists`-check before a file op — it's a TOCTOU race and an extra I/O round-trip. Attempt the op directly and branch on failure: catch, then `isErrno(error, "ENOENT")` (from `@zotlit/plugin-kernel/errno.ts`) for the missing/exists/etc. case. In Effect code the op runs on `FileSystem`, and the case is a typed failure: `Effect.catchReason("PlatformError", "NotFound", …)`, or `FileNotFound` (`lib/vault-errors.ts`) where a caller decides on it. See `packages/plugin-services/src/desktop/attachment-import/copy-attachments.ts`.

This applies to Node `fs` and adapter operations, which fail with an errno. A capability tag (`Vault`, `FileManager`) decides its expected outcomes from the vault cache instead; see [Expected outcomes](events.md#capability-tags).
