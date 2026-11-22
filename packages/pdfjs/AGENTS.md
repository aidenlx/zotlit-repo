# @zotlit/pdfjs

The vendored build of the pdf.js-zotlit fork. `dist/` is build output; the fork is the source owner. `provenance.json` identifies the imported revision and its patches.

For an engine update, build the fork first, then use `pnpm --filter @zotlit/pdfjs vendor --help` for the import command and its prerequisites. The importer requires a clean, tagged fork checkout and replaces the distribution, decoder licenses and provenance together. It does not build the fork.

After vendoring, regenerate `@zotlit/pdf-reader` through its scoped test/typecheck tasks. Its generated assets include the worker, decoders, styles and build identity from this package. `@zotlit/pdfjs-dist` is a separate upstream type copy used by Zotero types, not this engine's output.
