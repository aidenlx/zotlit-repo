---
name: delete-comment
description: Review and remove a batch of code comments, preserve design decisions in ADRs, and shrink the comment baseline.
disable-model-invocation: true
---

# Delete comments

1. Read [the comment policy](../../../policies/comments.md) and the instructions for the code in scope. Use the requested paths, or choose a bounded module or feature for one reviewable batch. Run `pnpm comments inventory` from the root for JSON lines with each JavaScript, TypeScript, CSS, YAML, and JSON-family comment's file, line range, and text. For other languages and embedded scripts, use their syntax to distinguish comments from strings and fixtures. Record the paths and starting revision.
2. Read each comment with its surrounding code. Record a category and action for each comment reported by the inventory. Related comments can share an issue or ADR.
   - **Tautology.** The current code already makes the point clear. Delete the comment.
   - **Excuse.** The comment explains away a confirmed implementation defect. Verify the failure, check for an existing issue, and file or reuse an issue with the code location, impact, and expected result. Delete the comment after the issue exists. Use [the issue tracker guide](../../../docs/agents/issue-tracker.md).
   - **Stale.** The comment describes behavior or constraints that no longer apply. Verify against current code, tests, or history. Delete the comment.
   - **Decision Record.** The comment explains a non-obvious choice, invariant, or trade-off. Add the reason to the relevant ADR, or write an ADR for a distinct decision. Reference the implementation from the ADR. Delete the comment when the rationale is recorded.
3. Before removing comments, check for tool directives, generated type documentation inputs, license notices, generated sections, and upstream copies. Keep required comments and their placement. Include untagged JSDoc and union member descriptions when checking for generator inputs. Record the tool, generator, or obligation for each retained comment. For comments that mix categories, preserve each verified decision or defect in its destination before deleting the block.
4. Keep edits to comment removal and any whitespace needed to preserve the code. Run `pnpm comments prune` and `pnpm comments check`. Compare syntax and tool directives. When a batch touches type documentation sources, regenerate the affected artifacts and verify their output is unchanged. See the comment policy for the template contract generator. Run focused tests if executable code or a fixture changes. The baseline should only lose entries.
5. Report reviewed paths, categories, issues, ADRs, deleted comment-only lines, and deferred work. Use `pnpm comments count` for a repeatable count of remaining comment-only lines and mixed code/comment lines in supported source files.
