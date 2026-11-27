---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and `pnpm test` once at the end: the tests of the changed packages and of the packages that depend on them.

Once done, use /code-review to review the work.

Commit your work to the current branch.
