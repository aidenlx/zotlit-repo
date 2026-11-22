# Item query core is Base-independent and asynchronous

The `@zotlit/item-query` core accepts one query over top-level, non-trashed Zotero Items and returns one result set. It exposes related creators, tags, collections, and attachment presence as Item properties, but it does not own Base files, global filters, named views, or filter inheritance. A future Base feature can adapt its document model into query-core calls.

The core interface is asynchronous and supports cancellation and chunked hydration from its first release. SQL lowering selects a sound candidate superset, and the Filter Expression evaluator remains the result authority. This design gives the Obsidian CLI a responsive, agent-friendly query surface without creating a synchronous interface that the next phase must replace.

## Filter Expression calls

Use the same function registry for validation, evaluation, and published signatures. Validate argument count, statically known types, and closed literal values before execution. At runtime an Error Value argument propagates, an unsupported null argument yields null, and an invalid type or closed value produces an Error Value without invoking the function. Empty or whitespace-only input behaves as missing for conversions. A non-finite numeric result produces an Error Value.

The evaluator handles lazy `if` and list element expressions directly. Bind `value` and `index` on each element, and `acc` for reduce. Generic methods are available on all types, including null and Error Values. Literal scalar lists can use a Set for membership. Exclude NaN so Set membership agrees with strict equality, and use evaluator comparison for non-scalars such as dates, which depend on the Query Clock. Sort heterogeneous lists by value type, with Error Values before null and null last. Preserve relative order for duration, list, and regular expression elements.

String replacement treats a literal pattern and its replacement as text. A regular expression uses JavaScript's replacement groups and global flag. Reset the match position before each stateful regular expression call so records see independent results. Bound repeat count and output size per call. Match native precision bounds and restrict split limits to the unsigned 32-bit range to avoid wraparound. Numeric rounding rejects a digit count when the corresponding power of ten is zero or non-finite.
