# Batches reuse excerpt outcomes with bounded memory

A batch retains completed Excerpt Image outcomes in a shared memory cache, initially limited to 32 MiB of encoded image bytes and 256 outcome entries. Least-recently-used entries are evicted when either limit is exceeded; eviction permits recomputation. Successful generated pixels remain reusable within that batch when IndexedDB persistence fails. Reuse requires matching verified source identity, Annotation rendering inputs, renderer version, and PDF freshness checks. The batch releases its retained outcomes when it ends. These initial limits are subject to measurement; the [batch retention record](../../../../docs/excerpt-image-batch-measurements.md) holds the avoided renders, reuse hits, and peak retained bytes they were measured at.

This scope covers Literature Note creation and update batches, Imported Note batches, and Child Notes imported through a Literature Note template. Nested imports share the initiating batch's outcome cache. Each destination note retains its own asset materialization and existing-image retention rules.

In the Literature Note batch test, two rows resolve the same Excerpt in sequence so their requests cannot share an in-flight render. The second row reuses the completed outcome. A write after the run renders again because the run releases the cache after its admitted tasks settle. A note update leaves a caller-owned outcome scope open so the next write in that run can reuse it. [Batch update tests](../../../../packages/notes/src/desktop/note-feature/update-batch.test.ts) · [Note operation tests](../../../../packages/notes/src/desktop/note-feature/operations.test.ts)

The batch also reuses render failures and uncertain Zotero fallback outcomes for matching inputs, avoiding repeated failed PDF loads for the same excerpt. Fallback pixels retain their uncertain provenance and remain separate from validated generated entries. A subsequent operation, changed Annotation rendering inputs, or changed PDF metadata retries normal resolution. Retention of failure records must also be bounded.

The Note Import batch test resolves each Excerpt in sequence to verify reuse of completed outcomes. The same scope serves every write in the run. A resolution after the last admitted write settles renders again because the run released the retained outcomes. [Batch import tests](../../../../packages/notes/src/desktop/note-import/batch-import.test.ts)

An Imported Note write uses the caller's outcome scope when supplied. A direct write opens and releases its own scope around the write. [Note Import write service](../../../../packages/notes/src/desktop/note-import/service.ts)

This refines the retry boundary in [ADR 0049](0049-excerpt-images-use-zotlits-cache-and-renderer-before-zoteros-cache.md): repeated requests within one batch can reuse the same outcome, while the next operation retries. The trade-off is that a transient failure can remain visible for the rest of the batch when its inputs appear unchanged. Shared source identity follows [ADR 0050](0050-excerpt-cache-identity-is-shared-across-verified-annotation-sources.md).

The import writer tests reuse a shared Annotation outcome across two Child Notes while each note renders its own template and accounts for its own use. They also cover reuse when nothing persists to the cache, and separate resolution when each note has its own initiating import.

Retain settled bytes even when their persistent write stalls or fails. A successful lookup updates recency. A readable PDF stamp invalidates a mismatch and drops its old record. An unavailable stamp supplies no new evidence. Keep uncertain Zotero fallback provenance. Skip an image larger than the budget so it cannot displace other retained results. Apply eviction synchronously and measure peak retained bytes after eviction.

Each initiating batch owns its own memory, including when multiple batches join the same render. Literature Notes, Imported Notes and Child Notes from the same operation can reuse one scope. The owner waits for admitted consumers and releases the retained records. A released batch cannot refill the cache. Interruptions, deadlines and queue teardown stalls do not retain outcomes, even when an interrupted render had already produced pixels. [Outcome scope](../../../../packages/annotations/src/obsidian/excerpt-image/outcome-scope.ts) · [Scope tests](../../../../packages/annotations/src/obsidian/excerpt-image/outcome-scope.test.ts)

Share the initiating scope with a note's nested Child Notes so each can reuse an excerpt already resolved by the batch.

The batch reuse probe runs the production service and scope with a counting renderer and no persistent store. This makes reuse visible in the render count. It releases each operation through the same ownership boundary as a note.
