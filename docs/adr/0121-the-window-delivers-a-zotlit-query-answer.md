---
status: accepted
---

# The window delivers a ZotLit Query answer, and the Worker runs and encodes it

Amends [ADR 0066](0066-item-query-is-a-deep-module-with-two-operations.md): the delivery of an answer, the place of the export file, and the cancel rule. Decided in issue #309, which covers #372.

## Context

The Query Job in the ZoteroReads Worker did three tasks in one module: it ran the ZotLit Query, it encoded the answer, and it delivered the answer. Delivery is knowledge of other owners. The inline limit is a limit of the command reply, and a file is a capability of the host. Each Worker root carried a flag for "can write a file", so the capability followed the library source: with the Zotero online library, a query with `output` answered `export-unavailable` on a desktop that can write files (#372). The export also had steps on both sides of one request: the window selected a staging path, the Worker wrote to it, and the window published it.

ADR 0066 kept the write in the Worker because a large value that crosses to the renderer can block it. #309 measured the alternative. A stream RPC over the Worker protocol makes the Worker wait for the reader of each chunk. In the Obsidian 1.15.1 renderer, 400 MiB as 1,600 chunks of 256 KiB gave a largest timer gap of 6.6 ms when the renderer wrote the file, against 5.2 ms when the Worker wrote it and 5.7 ms idle. The limit is 16 ms at p99 and 32 ms at most.

## Decision

- **Three tasks, three owners.** The query engine runs. The encoder in the Worker zone makes the answer document as UTF-8 chunks of about 256 KiB, and the CLI Contract module makes the envelopes. One delivery module beside `QueryService` delivers. The Query Job composes run and encode in the borrow and holds no limit and no file.
- **The answer crosses as a byte stream.** A stream RPC carries one head with the summary of the answer, then the chunks, then an optional trace. One function decodes this order into a summary, a document and a trace. The call takes one chunk at a time, so the Worker is at most one chunk ahead, and the borrow lasts as long as the delivery. A Query View and the custom-field read keep their unary request, because their result is typed data for a view.
- **Delivery has one function.** It takes a target (inline, or a file path) and the document. Inline gives the text within the limit of 1 MiB of UTF-8, and stops the document above it. A file target goes to the file capability of the host.
- **The file capability is a port that the host composition fills.** Its one operation writes a document to a path. Each adapter keeps one contract: the file appears complete or not at all, an existing file stays, a failed or interrupted document leaves no file, and a document that fails before its first chunk fails with its own error. The desktop adapter uses a staging file beside the output and a hard link. The staging file has a visible name that shows its output and its process (`<output>.<pid>-<uuid>.zotlit-partial`). Before the adapter opens one, it sweeps the folder of the output with the shared temporary-file sweep: it removes each file of this pattern whose process is not live and that is older than 1 hour. A host with no adapter answers `export-unavailable` before it sends the job. The Worker roots and the library source take no part in this decision.
- **The commit is with the reporter of the outcome.** The step that makes the file visible runs in the fiber of the window that gives the answer. A cancel before this step wins and leaves no file. From this step on, the export wins and the answer is the receipt.
- **An export is one value of the request.** The decoded query holds either no export, or one export with its path and its format.

## Considered options

- **The Worker writes through a file port of each Worker root.** It is the smallest change and keeps all bulk bytes in the Worker. The delivery then has three places (the window for the staging file and the commit, the Worker for the limit and the write, the root for the capability), and the capability still follows the Worker root. It stays the fallback if the renderer limits fail on the full path: the delivery function keeps its interface, and this shape becomes one more adapter of the file port.
- **The Worker stages, publishes and removes the file alone.** A cancel that arrives after the link can answer "cancelled" while the file exists, because the Worker handler maps an interrupt of the job to that answer. A Worker that the host terminates leaves the staging file.
- **The complete answer as one value to the renderer.** ADR 0066 rejected it, and that stays: a large string or result graph can block the renderer.

## Consequences

- The rule of ADR 0066 "Query Rows and bulk values stay in the Worker" becomes "bulk values cross to the renderer only as byte chunks of about 256 KiB". Query Rows and Temporal values stay in the Worker.
- An export gives the same file for each library source. The Worker file system serves only the attachment file probe, so the question of #307 stays open and separate.
- The renderer writes the export file. A renderer that is busy makes the export and its borrow longer, and a sync waits for the borrow (ADR 0120).
- `export-unavailable` stays in the CLI Contract with a new meaning: this device has no file capability. The source of the library has no effect on it.
- A process that stops during an export leaves its staging file. No design removes this on macOS and Windows: the file has a name until the commit. The next export into the same folder removes it, and until then its name tells the researcher what it is.
- The implementation must pass the renderer limits on the full path (query measure, `limit=all` export at 50,000 items) before it lands.
- The answer stream, the delivery module and the file port with its Node adapter add about 10 KB to the production `main.js` (5,690,916 B after the encoder split, 5,701,094 B with the whole change, measured in CI on the record PR). The `main.js` budget of ADR 0120 rises from 5,700,000 B to 5,720,000 B.
