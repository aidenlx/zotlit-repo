# @zotlit/shared

App-agnostic utilities consumed by several packages. `package.json` owns the public entry points; exports such as `@zotlit/shared/logging` name their entry without a file extension.

When changing library logging, read `src/logging.ts`: the module holds the sink for one JavaScript realm. The consuming app installs that sink, including in each Worker realm that uses it. The library does not configure app sinks.
