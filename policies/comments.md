# Comments

Put implementation intent in names, types, and tests. Put non-obvious design rationale in an architecture decision record (ADR). Put confirmed implementation defects in GitHub Issues.

## Review existing comments

Use [`/delete-comment`](../.agents/skills/delete-comment/SKILL.md) to review one batch at a time. Read each comment with the surrounding code and record its file, original lines, classification, and action. When a comment moves to an ADR or leads to an issue, record that destination in the audit.

| Classification  | Action                                                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tautology       | Delete a comment that repeats what the code already shows.                                                                                                          |
| Stale           | Verify that the described behavior or constraint no longer applies, then delete the comment.                                                                        |
| Excuse          | Confirm the defect and file or reuse a [GitHub issue](../docs/agents/issue-tracker.md). Delete the comment once the issue records the impact and expected behavior. |
| Decision Record | Record the decision and its reason in the relevant ADR, then delete the comment.                                                                                    |

Keep tooling directives and metadata in place. Examples include `@vitest-environment`, `@ts-expect-error`, `@ts-ignore`, `@internal`, lint suppressions, Vite import directives, editor folding markers, and comments read by code generators. Preserve the whole comment and its placement, including any suppression reason. Keep comments that make intentionally empty blocks valid under `eslint/no-empty`, including empty catch, conditional, and callback bodies. Keep comments required by a test fixture, license, or exact upstream copy. Keep the docs walkthroughs’ `OUTLINE-MISMATCH` markers with their associated assertions or capture steps, as required by the walkthrough authoring contract. Record the tool, test, or obligation in the audit. Make changes to a generated file or pinned upstream copy through its source.

Keep JSDoc that supplies generated type documentation, including untagged descriptions and descriptions on literal union members. The [template contract extractor](../packages/db/scripts/contract/extract.ts) reads these descriptions and the `@example`, `@ztFilter`, and `@ztInert` tags from the `zt` declarations in `packages/db/src/lib/context/`. The extractor also follows reachable types, including Annotation kinds, collections, dates, Extra, and tags. Their JSDoc supplies the generated reference, contract, and JSON Schemas. Record them as retained in the audit and keep their baseline entries. When a cleanup batch touches these sources, run `pnpm --filter @zotlit/db generate:contract` followed by `pnpm --filter @zotlit/docs generate:template-data` and verify that the output matches its pre-batch version. See [ADR 0015](../docs/adr/0015-template-contract-artifacts-generate-from-ts-types.md).

Keep emitted declaration descriptions and provenance headers in the Zotero Types and Companion generators. A comment stored in a generator string is part of its output. Compare generated files byte for byte and keep the output expectations in tests. The Resource Pack container stores its index, Pack Entries, and license notices in generated comments. Keep those strings and verify that builds produce the same bytes.

Use an ADR for an intentional constraint or trade-off. Use an issue when the implementation has a concrete defect or limitation that should be fixed. Include the affected behavior and the expected result so the issue can guide the fix after the comment is gone.

## Run the ratchet

The repository lint runs `pnpm comments check` and rejects new or edited comments in JavaScript, TypeScript, CSS, YAML, JSON, JSONC, and JSONL, including JSDoc and tool directives. The parser distinguishes comments from strings and YAML block scalars. Review embedded scripts and other formats with the syntax rules of their language. The [check source](../packages/config/no-comments.ts) lists generated and upstream paths it excludes.

The [baseline](../packages/config/comment-baseline.json) allows existing comments by file, comment text with normalized line endings, and occurrence count. It carries both unreviewed comments and comments retained for a specific requirement. Prune it after each batch to retire the deleted comments.

1. Run `pnpm comments inventory` to get file paths, line ranges, and comment text for the formats the check covers.
2. Review the batch and apply the actions above.
3. Run `pnpm comments prune` and `pnpm comments check`. Inspect the diff for removed or moved directives and compare syntax to verify comment-only edits. Run focused tests when the batch changes executable code or a test fixture.
4. Run `pnpm comments count` to report remaining comment-only lines and mixed code/comment lines. Deleting a comment from a mixed line leaves the code line in place.

Use the comment-only count as the upper bound for physical line savings in the formats covered by the ratchet. Exclude known required comments when estimating how many lines the remaining audit can remove.
