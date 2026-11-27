---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
---

Implement the work described by the user in the spec or tickets. When the user passes a ticket reference, fetch it from the issue tracker (`docs/agents/issue-tracker.md`) and state its title before starting.

Test each behaviour at the seams the spec names; `policies/testing-strategy.md` gives the test rules. Run `pnpm lint:files <paths>` and single test files regularly; the record PR's CI runs the package suites when the change lands.

When `pnpm lint:files <changed paths>` exits 0 and each new test passes, call the Skill tool with "code-review" to review the work, then commit to the current branch.
