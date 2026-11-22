# Each `zotlit:*` namespace versions its own CLI Contract

Every `zotlit:*` command namespace — citations, Template Workbench, Pandoc
integration — versions the wire format it answers with, and reports that number
as `contractVersion` beside the `command` field that names the namespace. The
three numbers move on their own schedules, so citations answering 1 while the
Workbench answers 2 states two independent facts rather than a skew. Each
namespace owns its diagnostic codes and payload shape, so a change to one leaves
the other two untouched; the `command` field already identifies which namespace
a number belongs to, so the number needs no field of its own to say so.

The version reaches an agent through two paths. The envelope carries it at
runtime, so an installed plugin is always the authority on its own shape. Each
skill records the version it was written against, because a skill installs from
the docs site at a commit unrelated to the installed plugin, and nothing
re-checks it when the plugin updates. That pin is the piece that can go stale,
so it is the piece that carries the number, and a difference triggers one rule:
read the live guide again, and follow the guide over the skill.

## Consequences

- The Template Workbench envelope owns its version constant beside its envelope
  code, as the citations and Pandoc namespaces already do. It answers 2, the
  value it has shipped since 2.0.0-beta.4 — a pinnable version moves forward
  only.
- `@zotlit/db`'s `CONTRACT_VERSION` covers the Template Contract and the
  generated schema `$id` alone. The `zt` data shape and an answer's shape change
  for their own reasons, so each carries its own number.
- Each guide states the scope of its `contractVersion` and leaves the value to
  the envelope, which reports it at runtime on every call.
- A skill's pin is the one value a skill restates from the CLI on purpose, as
  the root CLI + skill pair policy states. A change that bumps a namespace's
  version moves the pin of every skill written against it, in the same change.
- An agent whose skill arrived from a different commit than the installed plugin
  sees the difference in the first answer it reads, and reaches the live guide
  from there.

## Shared Obsidian CLI boundary

Run command Effects through the plugin shell's bridge with the unload signal.
An interrupted run reports the signal's reason instead of the squashed
interruption cause. A run submitted to the runner after unload stops at its
first pause. The regression test starts the Effect with a pause to model a
command that waits for Zotero. Ordinary failures report their squashed cause.
See the [runner](../../../../packages/obsidian-kit/src/cli-command.ts).

At registration, adapt failures to strings because Obsidian prints those as
`Error: <text>` and prints Error objects as `[object Object]`. Publish flags as
optional and put the required marker in the help text. This lets the ZotLit
decoder see tokens such as `--file=` and explain the expected `file=<value>`
form before Obsidian's own required-flag check can reject the call. See the
[registration adapter](../../../../packages/obsidian-kit/src/cli-rejection.ts).

## Parameter diagnostics

Keep the English diagnostic text stable under the [CLI text policy](../../policies/cli-text.md).
The [shared decoder](../../../../packages/obsidian-kit/src/cli-params.ts)
checks undeclared tokens, including `--` forms and `vault` after the command
name, before empty values and the first schema issue. Obsidian intercepts
`--copy`. Its native parser also treats a bare `a|b` in a `format` flag as a
list of shorthands and maps `a` and `--a` to `format=a`. A bare parameter
arrives as the string `"true"` and `name=` arrives as the empty string. Switches
accept both. A required value uses a distinct diagnostic for Obsidian's bare
parameter sentinel. A default starts in the encoded shape and follows the
same decoding as a supplied value. A parameter borrowed from another command
can have its own recovery message.

Select the variant from the raw parameters. Use the accepted fields from all
variants for token checks, preferring a real field to a field that represents
an inapplicable parameter. Declare a variant-specific refusal after the fields
its message depends on and before fields of lower diagnostic priority. Check
stray keys after schema decoding because the struct can drop a key that only
another variant accepts. Within a struct, field order determines the first
diagnostic. A rule across fields points to the field the caller should change.
A one-of rule points to the second named field that was supplied when too many
are present, or to the first candidate when none is present and one is
required. A schema issue without a parameter indicates a defect in the schema.

Map decoded input to the request in one direction. For JSON parameters, parse
before applying the payload schema. This lets the command use its own message
for malformed JSON and surface the schema's first issue for valid JSON with
an invalid shape. Preserve the CLI's existing fallback issue wording when the
schema supplies no message. Catch parameter rejections by class so the handler
can work with a generic Effect error channel. When a transport has no hint
field, append the recovery hint to the rejection text.

The Library Scope CLI owns its own contract version. Keep it in development
builds so the End-to-end Run can read the resolved state after a Scope Case
switch through a supported command rather than internal evaluation. Its guide
and diagnostics use the CLI's English text policy.
[Library Scope CLI](../../../../packages/plugin-services/src/obsidian/library-scope/cli.ts)

## Template Workbench contract and CLI registration

Use stable diagnostic codes with English messages and action-oriented
hints. Command descriptions, flag help, and guide text also use English
under the CLI text policy. Keep selector choices and guide topics in
shared registries so an accepted selector and its help agree.

The Template Workbench contract moved its Default selector to
`"default"` in version 5, added complete Profile checks and retained
attempt evidence in version 6, and changed document-check commands
and refusal envelopes in version 7. Version 8 adds the shared
Diagnostic Report fields and keeps the excerpt context for version 7
readers. Selector failures can occur before identity or document
facts exist. The envelope's success discriminator separates the result
from a diagnostic. Use the fault's specific recovery action first
and the registered hint otherwise.

Let the command parser check alternatives such as an Indexed Key or a
Citation example. Leave each optional in the host registration because
Obsidian checks required flags before invoking the handler. Keep the
angle-bracket choice form for the format flag. Obsidian otherwise
normalizes a bare format token before the handler can reject it.
[CLI text policy](../../policies/cli-text.md) · [Workbench registration](../../../../packages/template-workbench/src/desktop/cli/register.ts) · [Workbench envelope](../../../../packages/template-workbench/src/desktop/cli/envelope.ts)

### Workbench inspection and check answers

Inspection parsing, command registration, and generated help share the
selector definitions. Every top-level check refusal carries a recovery hint
because the Workbench Guide tells callers to follow it. A check can also
report failures in individual checks. A promoted render diagnostic carries
its editor code, parameters, and report. Draft read errors include the
message from the file read, and parser refusals use the parser's recovery
hint. Attempt lookups report unsupported parameters from decoding. Unknown
tokens and empty values fail before decoding.

[Inspection selectors](../../../../packages/template-workbench/src/desktop/cli/inspect-contract.ts) ·
[Check answers](../../../../packages/template-workbench/src/desktop/cli/check.ts)
