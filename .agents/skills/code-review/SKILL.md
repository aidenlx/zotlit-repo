---
name: code-review
description: "Review the changes since a fixed point (commit, branch, tag, or merge-base) along separate axes: Standards (does the code follow this repo's documented coding standards?), Spec (does the code match what the originating issue/spec asked for?), and a Security pass when the diff touches the Zotero connection, the database, the release scripts or the Companion. Runs each axis in a parallel sub-agent and reports them side by side as finding lines. Use when the user wants to review a branch, a PR, work-in-progress changes, a review round, or asks to \"review since X\"."
---

Review of the diff between `HEAD` and a fixed point the user supplies, along separate axes:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?
- **Security**: only when the diff touches the risky surface (step 4).

The axes run as **parallel sub-agents** so they don't pollute each other's context, then this skill aggregates their findings.

The issue tracker should have been provided to you. If `docs/agents/issue-tracker.md` is missing, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

Capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

Before going further, confirm the fixed point resolves (`git rev-parse <fixed-point>`) and the diff is non-empty. A bad ref or empty diff should fail here, not inside two parallel sub-agents.

In a later round of a review loop (`implement-spec` step 5), the fixed point is the head that the previous round read, so the round reads only the new diff. A review loop runs 3 rounds at most, and a round with no Important finding left ends it. After round 3, each finding that is still open gets the outcome `open point` ([Finding lines](#finding-lines)), and the record of the land lists it under Open points.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched via the workflow in `docs/agents/issue-tracker.md`.
2. A path the user passed as an argument.
3. A spec file under `docs/`, `specs/`, or `.scratch/` matching the branch name or feature.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** sub-agent will skip and report "no spec available".

### 3. Identify the standards sources

Anything in the repo that documents how code should be written, such as `CODING_STANDARDS.md` or `CONTRIBUTING.md`.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), always a `Nit`. Like any standard here, skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Spawn the sub-agents in parallel

Each axis has one reviewer. A finding stands on the rule or spec line it cites.

**Standards sub-agent prompt** should include:

- The full diff command and commit list.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The [finding line](#finding-lines) format and its severities, pasted in full.
- The brief: "Report each finding as one finding line, then cite under it: (a) for a place where the diff violates a documented standard, the standard (file + the rule); (b) for a baseline smell, its name and the hunk. A documented-standard breach can be Important; a baseline smell is always a Nit, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** should include:

- The diff command and commit list.
- The path or fetched contents of the spec.
- The [finding line](#finding-lines) format and its severities, pasted in full.
- The brief: "Report each finding as one finding line: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line under each finding. Under 400 words."

If the spec is missing, skip the Spec sub-agent and note this in the final report.

**Security sub-agent**, only when the diff touches the risky surface:

- the Zotero connection: `packages/protocol`, and `zotero-local-api`, `local-server` and `zotero-pref` under `packages/plugin-services/src/`;
- the database: `packages/db`, `packages/zotero-reads`, and `database` under `packages/plugin-services/src/`;
- the release scripts: `packages/scripts/lib/release`, `packages/scripts/lib/shell`, `.github/workflows/release.yml`;
- the CI and the land's GitHub client: `.github/workflows/record-pr.yml` (it holds an OIDC token), `.github/actions/setup-workspace`, `packages/scripts/lib/land-github.ts`;
- the Companion: `apps/zotero`.

Its prompt holds the diff command, the commit list, the finding line format, and the brief: "Report each way the diff lets untrusted input, a credential, or a published artifact do harm, as one finding line with the axis `Security`, and say how it can be exploited. Under 400 words."

### 5. Aggregate

Start with the counts: findings per axis, and per severity within each axis. Then present each axis's finding lines under its own `## Standards`, `## Spec` (and `## Security`) heading, in the reviewer's order. Keep the findings of each axis apart, because the axes are deliberately separate (see _Why separate axes_).

The record PR is public. A Security finding that stays unfixed goes to a private place, a draft GitHub security advisory or a local note under `.scratch/notes/`, and the record shows only the count of such findings.

## Finding lines

Each finding is one line, and the Review section of the record file (`land` → The record file) holds these lines:

```text
<severity> · <axis> · <location> · <outcome>
```

- **Severity:** `Important` (a breach of a documented standard, or a spec requirement that is missing, partial or wrong), `Nit` (a judgement call, such as a baseline smell), or `Pre-existing` (a defect in code the diff did not change).
- **Axis:** `Standards`, `Spec` or `Security` from this review, `Architecture` from `improve-codebase-architecture` in the final round of `implement-spec`.
- **Location:** `path:line`, relative to the repository root.
- **Outcome:** `fixed <sha>`, `waived: <reason>`, or `open point`. A reviewer writes the first three fields; the author who answers the finding writes the outcome.

The Review section starts with the counts: findings per severity, and per outcome.

## Why separate axes

A change can pass one axis and fail another:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking another.
