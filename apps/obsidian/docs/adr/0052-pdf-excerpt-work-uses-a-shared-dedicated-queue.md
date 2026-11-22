# PDF excerpt work uses a shared dedicated queue

Accepted design; implementation is pending.

The shared Excerpt Image service owns a dedicated queue for PDF loading, parsing, and excerpt rendering. Literature Note creation and update batches and Imported Note batches submit cache misses to this queue and await their results. The queue's concurrency and resource limits are independent of note-operation concurrency, and all consumers share it rather than creating a queue per batch.

Bounded freshness and cache checks run before PDF queue admission. A valid cached image can complete while an unrelated PDF is rendering. Identical in-flight work remains deduplicated across callers. Durable asset materialization belongs to each destination note and runs outside the PDF queue.

Each note awaits its own excerpt outcomes and can advance independently of other notes in the batch. Note writes and excerpt asset writes have separate ownership and scheduling; the PDF queue does not perform either vault write. An image embed is finalized only after its asset is successfully saved, or after an existing asset is verified for retention. The batch UI remains active until all admitted PDF work, excerpt asset writes, and note writes settle.

The queue initially runs one PDF job at a time. It may reorder pending requests into groups of at most four excerpts that reuse the loaded PDF, then gives other waiting PDFs a turn. Batch import and PDF reader viewing are mutually exclusive workloads for this design, so interactive-versus-batch priority is unnecessary. Both workloads share cache entries across transitions. Owned resources are released at the end of their bounded lifetime. Increased PDF concurrency requires performance and memory measurements.

The queue admits at most 128 distinct jobs. Producers wait for capacity when the queue is full; capacity exhaustion alone does not make an image unavailable. Capacity waits support cancellation. Batch cancellation retains its existing contract: queued note operations stop while admitted note operations finish.

This preserves progressive note completion while controlling expensive PDF work across concurrent consumers. It avoids making cached images wait for PDF work and avoids multiplying PDF concurrency when another batch starts. Existing PDF size, canvas, execution-time, and teardown bounds remain in force. Queue and fairness limits are initial tuning values to verify with measurements.

Validate freshness and check the cache before queue admission so a hit still answers when the render queue is full. Identical active work is shared and survives cancellation by any caller while another caller still needs it. The last cancellation releases the demand, subject to bounded render teardown. Admission logs include the requested key, bound usage and waiting producers. Use the layer's Effect clock for deadlines and finalizers.

The display's renderer-lifetime test doubles only the file and canvas and exercises the production renderer. Model the PDF.js intent state that exposes the render task and verify the document and task are live only while the read is in progress.

### Admission, execution, and teardown

Reserve capacity atomically and pass a released permit directly to the oldest waiter. Order render tickets by admission sequence when preflight finishes out of order. Run up to four preflight checks beside one render. A document may serve four consecutive crops before a waiting different PDF gets a turn. Share the render lane across borrowed and detached work.

Hold the running slot through its teardown. Queue resident-document destruction with renders and count it within the admission bound. It waits behind earlier renders and must finish before later work can load and draw. During service shutdown, interrupt and await job fibers before draining the queue and releasing the resident document. A cancelled wait for a preflight check does not release its lane while underlying store work still runs. Retain a resident document for later crops of the same revision without reopening its bytes. [Queue](../../../../packages/annotations/src/core/excerpt-image/pdf-queue.ts) · [Queue tests](../../../../packages/annotations/src/core/excerpt-image/pdf-queue.test.ts) · [Renderer tests](../../../../packages/annotations/src/obsidian/excerpt-image/renderer.test.ts)

The minimized Electron trial uses Chromium canvas encoding with 130 producers over five PDFs, measures the actual timer and Effect deadline clamping, and verifies that two producers wait past the 128-job bound. Crop scheduling does not depend on those timers. Its report can be written to the configured measurement path. PDF parsing and rasterizing have a separate crop trial. [Electron queue trial](../../../../packages/annotations/src/core/excerpt-image/queue-chromium.test.ts) · [PDF crop trial](../../../../packages/annotations/src/obsidian/excerpt-image/crop.test.ts)

Bound file open and close waits to five seconds. A private scope keeps ownership of late handles, and detached cleanup closes them after the crop stops waiting. Read at most the requested size and let the caller verify revision before publication. [Bounded file operations](../../../../packages/annotations/src/core/excerpt-image/file.ts)

The test queue's canvas Promise holds its permit until the task settles. Browser checks throw a message that names the measured state. The service shutdown harness owns a child scope it can close independently.

### Running PDF work measurement

Measure real Fixture PDFs in the app in addition to the Node
queue model. Wait for the Fixture index so startup is outside
timing. Use one CLI call per pass to avoid child startup between
requests. Allow time for the complete pass. A sequential cold
request can pay a fresh document load because residency is shared
during overlapping work. A warm request must return the same
pixels without PDF work. Compare generated fixture geometry and
independent Zotero PNGs in the rendering proof.

Sample renderer Node memory between requests for a batch peak.
Electron's process-memory probe can return null or fail to settle.
Bound it outside per-request timing and count answered samples.
If a dump races PDF.js worker destruction and rejects, ask again
after the rejection. Record batch counters as soon as they exist
so a later probe failure does not discard them. Serialize nested
measurements so the console preserves the fields.

[Real PDF batch](../../../../packages/e2e/src/excerpt-acceptance.ts) ·
[Rendering proof](../../../../packages/e2e/src/excerpt-rendering.ts)
