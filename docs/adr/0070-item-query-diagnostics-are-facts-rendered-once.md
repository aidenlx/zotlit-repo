# Item Query diagnostics are facts rendered once

> Amended 2026-10-15 ([#1503](https://github.com/aidenlx/zotlit/issues/1503)): a request can set `onFormulaFault: "leave-out"`. The query then leaves out each Formula with a mistake and each Formula that reads one, and gives the Diagnostic of each in `formulaDiagnostics` beside the rows; a Formula that nothing reads gives no warning. The Query View uses this policy, and it shows the engine's sentences for these Diagnostics, `reads-faulted-formula` included, in place of a sentence from its own message catalog. The CLI keeps `"fail"`: the first root Fault fails the request, and its answer does not change. The multi-error accumulator stays deferred for the CLI; the leave-out policy needs no poison node.

An invalid Item Query fails inside the engine, at a validator site, a request check, or the custom-field check of hydration. Each site states a Fault: a typed fact with the kind of mistake, the place, and what was found and expected there, and no sentence. One diagnoser in `@zotlit/item-query` turns a Fault and the argument text into the Diagnostic: every sentence template, the candidates filtered by the static type of the value the name was read on, the near-match ranking, the excerpt, and the corrected argument when a generic rule gives one. The diagnoser lives in the engine package because the Query Job serializes its answer inside the ZoteroReads worker (ADR 0068), where the registries, the filter text, and the source's custom-field names are; the Obsidian adapter copies fields and adds none. The Filter Expression package reports a Syntax Fault with the token found, the tokens its grammar accepts there, and the unclosed opener, and keeps its parser private (ADR 0062).

The Item Query CLI Contract moves to version 2 (ADR 0065). A Diagnostic keeps `code`, `message`, `hint`, `location`, and `details` with their version-1 meanings and adds `severity`, `report` (the Diagnostic Report as an array of lines, one JSON string per line so the pretty-printed envelope shows it as lines), `excerpt` as `before`, `at`, `after`, `found`, `expected`, `suggestions`, and `location.path`. `hint` carries the most specific action available, so a version-1 reader gains from the change. A successful answer carries `warnings`, always present, before `rows`: a Query Warning for a comparison whose operand types can never be equal, which the evaluator proves (equality coerces nothing, ordering of different types is null, `!=` is the negation of equality). Version 2 grows by additions: a new code, a new field, or a new suggestion rule needs no version bump; a changed meaning of an existing field does.

The base diagnostic builder and the rejection adapter that four `zotlit:*` namespaces repeat move into one shared module of the Obsidian app, with no wire change. The rich part stays in the engine with one adapter; it lifts into the shared module when a second CLI reports a fault in caller-written text from a span ZotLit computes, which the Template Workbench is first to need ([#1392](https://github.com/aidenlx/zotlit/issues/1392)).

Considered and rejected: sentences composed at each fault site, the state before this decision, which gave sixteen sites their own prose and one generic hint for most argument faults, and which four blinded agents scored between 3.1 and 3.9 of 5 while reporting five of eight never-matching filters to the user as true empty results; rendering in the Obsidian adapter, which would put the renderer and the registries it reads in two packages; a shared diagnostic package now, which would be a seam with one adapter; a multi-error accumulator in the validator, which needs a poison node and is deferred, with the wire shape ready for a `diagnostics` list; list element types and closed value sets, which arrive as additions and are out of this decision.

Plan Formulas reached by a projected field, the filter, or a dependency of another reached Formula. Under leave-out, check reached custom fields against the source during Formula planning and carry the omitted Formula diagnostics beside the results. A validation error in an individual fields or sort entry identifies that entry in the submitted argument.

## Formula planning and diagnostics

Find Formula dependencies by walking the parsed expression in source order. Ignore names in strings. If parsing fails, report the Syntax Fault for that text instead of inferring dependencies from it. Treat every valid caller-supplied name as data, including names shared with JavaScript object properties. Reserve `formula.<name>` for projecting Formula columns. Sorting and grouping run before Formula projection, so those operations reject paths in the reserved namespace.

Plan each reached Formula once and keep successful plans in dependency order. Under leave-out, find cycles before calculating individual plans. For each member of a cycle, give the shortest cycle back to that member, breaking ties in expression order. Other readers get a diagnostic at the reference to the faulted Formula, with the root cause as a note. Continue planning remaining reached dependencies, even after a failed reference, so the diagnostics cover every reached Formula. If the filter reads a faulted Formula, the filter still fails, and the error carries the reached Formula diagnostics.

Under fail, invalid names take precedence. Plan filter references before projection columns and follow references depth first in expression order. Report the root Fault for a reached dependency. Discover a cycle when a reference returns to an in-progress Formula. The source check can reject an absent custom field in a planned Formula. Under leave-out, locate that error on its Formula. In the failure policy, the query's source check can fail the request after planning.

Serialize Formula lists element by element. A scalar can flow directly, a calendar date uses the date object shape, and a timestamp uses an instant. An Error Value carries its stable code and rendered message. A record, duration, or regexp is outside the projected value vocabulary.

## Excerpts and regression tests

Use UTF-16 offsets with an exclusive end. Keep excerpts bounded and account for escape characters when placing the caret. Show a visible mark for a zero-width span. An unmatched delimiter gets a second mark. If that opener is outside the fault excerpt, use its own bounded excerpt. Keep Query Context when checking a suggested correction. Offer a correction only when it preserves the comparison and surrounding text and can be validated. A warning marks operands without changing their evaluation. Render adapter rejections from their structured facts through the same report path, independent of the adapter or validation library.

Formula policy tests generate reproducible requests with a fixed seed, and add a named regression case when a generated request fails. The oracle plans each Formula alone with its reads stubbed where any value type is legal. It uses strongly connected components to find cycles independently of the planner. Shuffle projection fields to vary planning order. Compare original text order for the first fault while allowing the source check to select any implicated Formula where order is unspecified. Golden diagnostic cases exercise the full report, excerpt and caret, while decoder tests keep the structured input facts. Reuse read-only scenarios and open a separate database for a case that mutates the source.

The query reports warnings for the filter and each reached Formula in their own source text order.

## Evaluation faults and Formula values

Keep Error Value facts and their renderer together. Value formatting can render an Error Value directly, and the diagnoser can reuse its operand and type phrases without a circular import through the value modules.

Reuse the hydration needs of a Formula across references. A planned Formula carries offsets into its own text, while the reference node carries offsets into the caller's text. Cache a Formula value on the record by its planned root and Query Clock so filtering, dependent Formulas, and projection can share an evaluation. Evaluate the Formula without the caller's element bindings.

A constant-comparison warning leaves the evaluated result intact, including an Error Value from ordering incompatible types. A pair of nullable expressions can both produce null, and an unknown type can match. A comparison to an explicit null literal can test for missing data, so it does not get that warning.

An Indexed Key outside the Target Libraries produces a warning without widening the read. Report the warning both when the result is empty and when another branch supplies matches.

Check diagnostic selections across all expression branches, including Relation List predicates. Rank Collection suggestions by case-insensitive full-path equality, then by the smaller edit distance to the whole path or leaf. Break ties by whole-path distance and then source order. A bare Indexed Key refers to My Library even in a group-only query. Use a dictionary without a prototype for names supplied in the query so names such as `constructor` and `__proto__` remain ordinary keys.

Keep a CLI list element's index distinct from its UTF-16 character span. A wrong Formula still fails the CLI with its own text span. The typed Query View can leave out that Formula and its readers. Preserve typed query diagnostics through the adapter. The database reader logs unsupported layouts once per copy, so the answer carries the corresponding diagnostic without a duplicate log.

A View Plan sends the file's Formula definitions and lets the engine plan the ones it reads. Display Formula diagnostics from the result snapshot that is on screen, or from a failure that cleared it. A Formula left out by the engine has no cell value.

## Shared CLI diagnostic adapter

The [Obsidian Kit adapter](../../packages/obsidian-kit/src/cli-diagnostic.ts)
uses the Item Query report renderer and keeps each namespace's diagnostic codes
and details. A rejected parameter includes its issue path and received value.
For a source fault, the location uses a one-based line and column, and the
span uses UTF-16 offsets with an exclusive end. Display the line on which the
fault starts so the caret stays with the excerpt in multiline input. Preserve
the full span in the location and use the supplied source name in the report.
A specific recovery action takes precedence over the code's registered action,
which stays at the end of the report when both are present.

## Diagnostic presentation in a view

Build the view's sentence, corrections, and excerpt from structured fields
shared by Query View and the Match editors. Omit a hint that only repeats the
expected forms, and show a correction list when there is more than the one a
hint can name. Keep only the line where the fault starts and count code
points in that displayed line. Mark a zero-width fault with one character.
[View diagnostic](../../packages/obsidian-kit/src/reader-diagnostic.ts)

The Workbench CLI renders golden Diagnostic Reports from fixed Fault
values so the contract check does not depend on a template engine.
[Workbench envelope tests](../../packages/template-workbench/src/desktop/cli/envelope.test.ts)

### Formula field and dependent results proof

Wait for the expression field's input update and subsequent
diagnostic frame. Use `aria-invalid` from that frame to confirm
a previous underline cleared. Keep a wavy fault underline and
omit the gutter and hover tooltip. Check focus chrome against
the native text input. The Name field has initial focus. Block
saves for text that fails syntax checking. New Formulas save
through Add Formula, and an existing Formula saves as it is
edited or its page closes. Show an engine fault only for the
saved expression that produced it.

Compare Formula results with ZotLit Query across a tab, embed,
Query Block, and List. When one Formula is invalid, report
separate diagnostics for it and its dependents in one run while
preserving other columns. A filter that reads a failed Formula
clears the rows, and a removed Formula leaves its filter
reference with a diagnostic. For a per-record Error Value, draw
a mark without placeholder text and keep the other row values.

[Formula cases](../../packages/e2e/src/query-view-properties.e2e.ts)

A malformed filter can keep the previous cards and their count
while the view reports the fault. Lint marks may finish after the
row renders, so wait for the expected span and check that there is
no empty hover tooltip. Report the expected syntax tokens once at
the offending location.

[Filter diagnostic cases](../../packages/e2e/src/query-view.e2e.ts)
