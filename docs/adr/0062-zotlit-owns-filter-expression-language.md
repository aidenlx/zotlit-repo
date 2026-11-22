# ZotLit owns the Filter Expression language

ZotLit defines and evolves the Filter Expression language. Its syntax takes inspiration from Obsidian Bases for user familiarity, while ZotLit tests specify the supported behavior. The initial contract keeps the existing grammar behavior, including its edge cases, and uses focused unit tests as the source of truth. This lets the grammar evolve with ZotLit query needs and keeps its contract independent of an Obsidian release or proprietary parser data.

## Public tree and diagnostics

Consumers validate identifiers and calls against the typed AST in
`packages/filter-expression/src/ast.ts`. The package owns Lezer node names
and token layout. Strict vocabulary validation gets a typed AST only after
a clean parse. `parseExpression` also returns Lezer's recovered tree so an
editor can inspect it while the user types. Recovery shape is an internal
detail. Syntax Fault locations use UTF-16 offsets.

A partial typed AST allows a call or bracket still open at the end of input
and treats unfinished uncalled member access as its object. The editor can
supply the source range of the object whose members it is completing. Empty
recovery markers for missing tokens can be skipped. Missing operands and
skipped text yield no partial AST. The grammar spans an escape but leaves its
interpretation to the typed AST. It accepts any expression as a callee and
leaves its meaning to the consumer. Empty brackets can form a list. Access
requires an index. Blank-input meaning also belongs to the consumer.

`syntax-fault.ts` contains the version-specific Lezer access needed for
expected-token diagnostics. It saves the active stack array before advancing
because Lezer replaces that array and can append split stacks. End-of-input
acceptance can require reductions, so the diagnostic verifies it by parsing
the prefix. Editors underline the token at the fault if one exists. At the
end of input they underline an unclosed quote or bracket, then fall back to
the preceding token. The generated grammar's selectable names are public to
the editor. Their declaration order and the recovery shape are implementation
details.

## Stored Filter Trees

Filter Trees use the Bases storage shape. An empty `and` or `not` group holds
for every record. An empty `or` holds for none. A `not` group holds when none of
its entries holds. The reader accepts numeric and Boolean leaves as expression
text only when the consumer selects that scalar policy.

The root group has the empty Filter Path. A single leaf has path `[0]`, like
the only entry of an `and` root. Composition wraps each joined part so it
binds as one operand, keeps a lone part unchanged, and tracks the leaf path
and text span so diagnostics can point back to the original leaf.

## Editor type inference

Plan the partial tree with the same validator and list-method scopes as a complete Filter Expression. Use the outermost node with the exact requested span. If validation stops after that node, its type is still available. Member suggestions use the known record keys or the dataset's field names narrowed by the planner. A custom field uses its bare name or bracket access. A Query Context record exposes its key fields. The editor can supply the fact that a context record is bound before a live record is available. Plan Formulas on first read so the editor can type references using the same scope and vocabulary as the query.

A flag letter outside the grammar reports a Syntax Fault at that letter. A regular expression pattern or flag combination rejected by the JavaScript engine reports a validation Fault at the full literal.

Use one CodeMirror input for Match conditions and Formulas. Prefer a syntax fault over a run fault when marking the expression. Give the input box native Obsidian height, padding, and focus treatment while scoping the template token colors to its content. Use a hidden label for the editable content. Cache the popup key extension per app so the field keeps its extension as it renders in a chooser, popover, or separate window.
