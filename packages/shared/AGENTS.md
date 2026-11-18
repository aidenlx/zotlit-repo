# @zotlit/shared

Shared utilities consumed by multiple packages — app-agnostic.

## Module resolution

The package exports its TypeScript source, which Node loads by stripping its types and the app bundlers compile. Relative imports name their file with its extension:

```ts
import { createNanoEvents } from "./nanoevents.ts";
```

## Logging

Log through Effect in files that import it, with `withLogCategory` from `src/logging.ts`; use `logLibrary` from that module only in Effect-free files. Categories start at `["zotlit", "shared", ...]`. The consuming app installs the log sink and configures the sinks.

```ts
import { Effect } from "effect";

import { withLogCategory } from "./logging.ts";

Effect.logDebug("Event emitted").pipe(
  withLogCategory("zotlit", "shared", "nanoevents"),
);
```

Never call `configure()` here — that belongs to the consuming app.
