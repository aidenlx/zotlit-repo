# Contributing

> Contribution guidelines (code style, PR process, issue triage) will be
> added here as the project matures.
>
> Bug reports and feature requests via
> [GitHub Issues](https://github.com/aidenlx/zotlit-repo/issues) are welcome.

## Releasing

The source lives in `aidenlx/zotlit-repo`. Releases publish to the publish
repository `aidenlx/zotlit`: the plugin releases, the Resource Releases, the
Companion releases and its `zotero-release` update channel. Code reads the two
names from `packages/config/repositories.ts`. The publish repository holds a
generated shell that builds the plugin from the npm bundle package
([ADR 0095](docs/adr/0095-the-publish-repository-is-a-thin-generated-shell.md)).

Each app's `apps/{app}/package.json#version` is the sole version source.

| Product                       | Tag format   | Example                       |
| ----------------------------- | ------------ | ----------------------------- |
| Obsidian (`@zotlit/obsidian`) | bare semver  | `2.0.0`, `2.1.0-beta.1`       |
| Zotero (`@zotlit/zotero`)     | `zt-` prefix | `zt-2.0.0`, `zt-2.1.0-beta.1` |

Both repositories carry each tag. In `aidenlx/zotlit-repo` it names the
commit the release was built from; in `aidenlx/zotlit` it names the shell
commit (plugin) or the release (Companion).

### Branching model

- **`next`** = primary working branch. All features and fixes land here.
  Pre-releases (`2.1.0-beta.N`) ship from `next`.
- **`main`** = stable. It takes stable graduations (a fast-forward to a commit
  of `next`) and emergency hotfixes (patch-only).

See [ADR 0021](docs/adr/0021-next-is-the-primary-branch.md).

### Landing a change

A change reaches `next` through `pnpm land`, run from the task worktree on its
branch with a clean tree. Lands on one machine run one at a time, in a queue:
each fetches `origin/next`, rebases the branch onto it, runs `pnpm verify` on
the rebased tree, and pushes it to `next` as a fast-forward. The gate cannot be
skipped. The pre-push hook lets only `pnpm land` push `next` and `main`.

`pnpm land --to main` graduates: from a checked-out commit of `next`, it
checks that `main` can fast-forward to it, runs `pnpm verify --release`, and
pushes it. `pnpm land --to main --hotfix` lands a task branch off `main` onto
`main` with the same gate.

### Version policy

Keep the **beta line strictly ahead of stable**: every `next` version must be
greater than the current `main` version, and `main` stays on patch bumps
(`2.0.x`) until the in-flight beta graduates.

This is a **maintainer convention** — `pnpm release` does not block
out-of-policy bumps. Check the chosen version against the counterpart line
before you confirm the release.

### How to release

```text
person          pnpm release ─▶ version commit ─▶ Land Queue ─▶ next / main
                                (release gate in the Land Turn)
aidenlx/zotlit-repo  release.yml on the push:
                plan ─▶ verify ─▶ obsidian: npm ─▶ shell commit + tag ─▶ tag here
                               └▶ zotero:   zt-<v> release ─▶ update channel ─▶ tag here
aidenlx/zotlit  plugin-release.yml of the shell, on the tag:
                official Obsidian action ─▶ res-<v> ─▶ publish the release
```

1. Check out `next` (pre-releases and stable graduations) or `main`
   (hotfixes), at the tip of its origin branch, with a clean tree.
2. Run `pnpm release`. The interactive script bumps the versions, syncs the
   root `manifest.json` and `versions.json` for a stable plugin release,
   refreshes the lockfile, commits on a local release branch, and lands that
   commit through the Land Queue. The release gate (`pnpm verify --release`,
   which includes the End-to-end Run, so desktop Obsidian must be running)
   runs once, in a Land Turn, on the tree that is pushed:

   | Versions picked        | Route                                                           |
   | ---------------------- | --------------------------------------------------------------- |
   | pre-release, on `next` | land into `next` with the release gate                          |
   | stable, on `next`      | land into `next`, then fast-forward `main` to it (release gate) |
   | patch, on `main`       | land onto `main` with the release gate (hotfix)                 |

   To release without prompts, name each app and its version: a bump the
   picker offers on that branch, or an explicit version.

   ```sh
   pnpm release --obsidian prerelease
   pnpm release --obsidian 2.3.0-beta.0 --zotero 2.3.0-beta.0
   pnpm release --obsidian minor --zotero minor   # stable graduation from next
   ```

   On a failure the script deletes its release branch and returns to the
   branch it started on. A failed graduation leaves the version commit on
   `next`; the output says how to graduate after the fix.

3. `release.yml` in `aidenlx/zotlit-repo` runs on the push. Its `plan` job
   publishes each product whose version is on the line of the pushed branch
   (a pre-release on `next`, a stable version on `main`) and has no release
   tag in `aidenlx/zotlit-repo` yet. The `verify` job runs the release gate on
   the pushed tree (the desktop checks skip there). Then each product runs
   `pnpm release:publish <product>`:
   - **Obsidian:** production build with the docs site of the line, the npm
     bundle package (dist-tag `beta` or `latest`, with provenance), the shell
     with its lockfile resolved from npm, a frozen install and build in a
     clean folder that must reproduce the app's `main.js` and `styles.css`,
     the shell commit on `beta` or `main` of `aidenlx/zotlit` with the version
     tag (one atomic push), and the tag in `aidenlx/zotlit-repo`.
   - **Companion:** the XPI on the release `zt-<version>`, the update
     manifests on `zotero-release`, and the tag in `aidenlx/zotlit-repo`.
4. The tag starts the shell's own `plugin-release.yml` in `aidenlx/zotlit`. It runs
   the official Obsidian action (scanner lint, attestation, draft release),
   creates and checks the Resource Release `res-<version>`, and publishes the
   release (a pre-release for a beta). See
   [docs/CI_SETUP.md](docs/CI_SETUP.md#release-workflow).

`pnpm release:publish <product> --dry-run [--version <v>]` runs the whole
publish with local stand-ins and prints the commands a real run executes.

### Pre-release cycle

1. **Start the beta.** On `next`, run `pnpm release`, pick
   `preminor`/`prerelease` → `2.1.0-beta.0`.
2. **Iterate.** Land changes into `next` with `pnpm land`. Run `pnpm release`
   with `prerelease` → `2.1.0-beta.1`, `.2`, …
3. **Ship stable.** On `next`, run `pnpm release` and pick `minor` → `2.1.0`
   for both apps; they graduate together. `main` fast-forwards to the version
   commit, so `next` and `main` are the same commit after it.
4. **Start the next beta.** Run `pnpm release` on `next` with `preminor` →
   `2.2.0-beta.0`.

### Hotfix path

For urgent stable patches (security fixes, regressions) while `next` has
unreleased features:

1. Make the fix on a task branch off `origin/main` and land it with
   `pnpm land --to main --hotfix`.
2. On `main`, run `pnpm release` with `patch` → `2.0.2`.
3. Bring the fix into `next`: on a task branch off `origin/next`, run
   `git merge origin/main` (resolve version conflicts toward the next
   prerelease), commit, and `pnpm land`. The land keeps the merge, so `main`
   stays an ancestor of `next` and the next graduation can fast-forward.

### Distribution channels

| Channel     | Obsidian                                             | Zotero                                         |
| ----------- | ---------------------------------------------------- | ---------------------------------------------- |
| Pre-release | [BRAT](https://github.com/TfTHacker/obsidian42-brat) | `update-beta.json` on the `zotero-release` tag |
| Stable      | Community plugin store + BRAT                        | `update.json` on the `zotero-release` tag      |

### First release from the new flow

The first release of the two-repository flow is `2.3.0-beta.0` for the plugin
and the Companion. The npm package does not exist before it, so trusted
publishing cannot be set for it yet, and its first publish runs from the
lead's machine, logged in to npm as the owner of the scope.

1. Do the settings in [docs/CI_SETUP.md](docs/CI_SETUP.md#settings-outside-the-repository)
   that come before the first publish. Keep Actions off in `aidenlx/zotlit-repo`.
2. On `next`: `pnpm release --obsidian 2.3.0-beta.0 --zotero 2.3.0-beta.0`.
3. On the landed commit of `next`, with a clean tree:
   `pnpm release:publish obsidian --dry-run`, read its output, then
   `pnpm release:publish obsidian`. It publishes the npm package without
   provenance, pushes the first shell commit onto a new `beta` branch on top
   of the `main` history of `aidenlx/zotlit` with the tag `2.3.0-beta.0`, and
   pushes the same tag here. Use the Git and `gh` login of the lead, or set
   `RELEASE_REPO_TOKEN`.
4. Watch the shell's `plugin-release.yml` in `aidenlx/zotlit` publish `2.3.0-beta.0`
   and `res-2.3.0-beta.0`.
5. Set trusted publishing for the npm package (docs/CI_SETUP.md).
6. Enable Actions in `aidenlx/zotlit-repo` and run `release.yml` with
   `workflow_dispatch` on `next`. Its plan skips the plugin (the tag exists)
   and publishes `zt-2.3.0-beta.0`.

### A step failed half way

Every step of `pnpm release:publish` finds what an earlier run did, so the
first action is to run the same publish again: re-run the failed job, or run
`release.yml` with `workflow_dispatch` on the branch.

| Step that failed                      | State                                                    | Action                                                                                                                |
| ------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `verify`, `build`, `pack`             | nothing published                                        | Land the fix, then run the workflow again.                                                                            |
| `npm`: other files on npm             | that version is on npm with other content                | npm versions are immutable. Release a new version (`pnpm release`, `prerelease`).                                     |
| `registry`                            | the package is on npm; the registry did not serve it yet | Run again; the publish step skips the version on npm.                                                                 |
| `shell`, `check`                      | the package is on npm; nothing pushed                    | Run again. When the fix changes the bundle, release a new version: the version on npm stays as it is.                 |
| `commit`: the tag names another tree  | the tag exists in `aidenlx/zotlit`                       | Check that tag by hand. A published version is not made again: release a new version.                                 |
| `push`                                | nothing moved (the push is atomic)                       | Run again. When `beta` or `main` of `aidenlx/zotlit` moved, the next run builds on its new tip.                       |
| `source tag`                          | everything in `aidenlx/zotlit` is done                   | Run again; the plan publishes the product until this tag exists.                                                      |
| Companion `release`, `update channel` | `zt-<v>` may exist                                       | Run again. The run reuses the XPI on `zt-<v>`, so the update manifests hash the file users download.                  |
| shell workflow in `aidenlx/zotlit`    | the tag exists there; the release may be a draft         | Re-run that workflow. When the official action stops on the draft it made, delete the draft (not the tag) and re-run. |

A release whose fix needs a new version can leave an orphan `res-<version>`
or a draft in `aidenlx/zotlit`, and a version on npm that no release uses
(`npm deprecate` it). Delete the orphan release by hand.
