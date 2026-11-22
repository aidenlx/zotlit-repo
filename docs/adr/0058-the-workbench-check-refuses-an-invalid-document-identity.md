# The Workbench check refuses an invalid document identity

`zotlit:template-check` answers one question: what happens when this source is
used. A document whose identity the vault rejects can never be used, so the
check refuses it instead of reporting a check that passed. Two identities are
refused. A Template Draft whose manifest ID is neither `default` nor a Profile
ID of 12 letters or digits returns `INVALID_PROFILE_ID`, the same rule the
saved Profile scan applies. A saved Shared Partial whose filename is a Reserved
Partial Name returns `RESERVED_PARTIAL_NAME`, the same rule partial
reconciliation applies. Before this decision both cases reported success, so an
agent could check a draft, save it, and watch the vault reject the source the
check had just approved.

A refusal is not a failed check, and the answer says which one it is. A refusal
raised before the source is parsed carries no `checks` field, because no check
ran: the reserved name is read from the filename. A refusal raised from parsing
carries the `checks` map with the check that failed, because that check did run.
Forcing one shape on both would make one of the two answers untrue, so the two
shapes stand and the `check` guide topic states the rule.

## Considered options

- **Report the invalid identity as a failed check.** Rejected. It claims a check
  ran against a document the vault does not accept, and it puts the identity
  rule inside the check results, where an output selector could hide it.
- **Report a diagnostic and check the source anyway**, which is what ADR 0039
  does for an unevaluable Profile Match. Rejected here, and the difference is
  the point: ADR 0039 governs configuration that must never block note creation,
  so an unevaluable match is a nonmatch with a diagnostic. The check is the
  surface whose whole purpose is to predict the saved result, and a passing
  answer there is read as permission to save.
- **Leave both cases passing** and rely on the agent to notice. Rejected. A
  false success is the one answer this command must never give.

## Consequences

- The 12-letters-or-digits rule stays an Obsidian-app rule in
  `lib/profile-stamp.ts`, not a Template Document schema rule. The manifest
  schema still accepts any non-empty ID, so the rule applies where Profiles are
  resolved.
- The Note Preview keeps rendering a draft whose ID fails the rule, with the
  draft's own bindings. It is a human surface, so ADR 0031 and ADR 0039 apply
  there: an invalid document is diagnosed where it lives and blocks nothing.
  `bindDraftProfile` therefore exposes a validated entry point and a separately
  named unvalidated one, rather than one entry point with a cast inside it.
- Both refusals were added while Template Workbench CLI Contract 7 was
  unreleased, so the version does not move for them. A refusal added to a
  published contract would move it, because a call that used to succeed now
  fails.

### CLI request and fault boundaries

Parse the selector, resolve the connected identity, check the caller's
expected source, and then wait for pending Template edits to compile
before reading or rendering. A Citation can use a built-in example
without looking up an Item. A Shared Partial selects its caller root,
and a Citation root also selects the Citation Variant. Data discovery
parses accessors without evaluating arbitrary expressions.

Preserve omitted frontmatter patch values so the handler can reuse
existing values or choose defaults. Validate removal and reorder
against the configured fields after parsing. An absent guide topic
selects the quickstart. The schema command lists every root.

A missing generated contract entry indicates inconsistent build
metadata. Log it as a plugin defect. For a parser fault, report the
document and offset even when source is unavailable. When a called
template supplies the failure location, use that template's source for
its excerpt and line. A data-root read runs no Template of its own,
so it names a Template only when the error does.
[CLI requests](../../packages/template-workbench/src/desktop/cli/request.ts) · [CLI handlers](../../packages/template-workbench/src/desktop/cli/cli.ts)

### Check Attempt and source evidence

The entry point parses the request, checks selectors and flags, acquires the
source, and assembles one Check Attempt. Its document branches receive the
validated Profile identity or caller root and extend the answer by value.
They preserve failures from the checked source and the Templates it calls.
A draft uses its own diagnostics because installed diagnostics describe the
saved revision. For a Profile, fingerprint the annotation data without
evaluating the Citation getter. The check verifies the source of the
separately evaluated Citation Template.

Create renders a new note. Update reads exactly one baseline from the Item's
note, an explicit note path, or supplied text. The CLI and native preview
compose baselines in memory to retain the note's outside body and unrelated
Properties. Undefined selects create and null selects a synthetic update
baseline. Check each Managed Frontmatter contribution independently. Preserve
the engine report and use source locations verified by the shared diagnoser.

Retain the latest finished attempts and evict the oldest at the limit. Attach
render reports to a copy of the checks map. Apply output and evidence selectors
after the attempt finishes, to a separate response copy. A subsequent lookup
can disclose evidence omitted from the original response. Always include the
top-level Diagnostic Report when represented as lines.

### Inspect the requested revision

Compare the first disk snapshot with the exact bytes reconciliation recorded.
Keep that snapshot through the wait and set its time budget before the first
read. A confirmed absence selects built-in source for canonical customization
paths. Verify the complete installed Shared Partial registry and the Citation
Template because a dynamic Eta include can select a dependency at render time.
Inspection can report a registry diagnostic, a Profile scan problem, a manifest
error, or a compile error. A compile error can lack a diagnostic code.

[Check Attempt](../../packages/template-workbench/src/desktop/cli/check.ts) ·
[Source inspection](../../packages/template-workbench/src/desktop/cli/inspect.ts) ·
[Profile check](../../packages/template-workbench/src/obsidian/cli/check-profile.ts)
