# Contributing

ZotLit has two repositories:

| Repository                                                      | Holds                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [`aidenlx/zotlit-repo`](https://github.com/aidenlx/zotlit-repo) | The source: all code, its history, the docs site, and the issue tracker                       |
| [`aidenlx/zotlit`](https://github.com/aidenlx/zotlit)           | The releases, and a tree generated at each release that builds the plugin from an npm package |

- **Code changes** go to `aidenlx/zotlit-repo`, the one repository that takes
  pull requests, against `main`. Run `pnpm verify` before you push. A pull
  request into `main` runs `pnpm verify --pr` in CI
  (`.github/workflows/record-pr.yml`). A maintainer lands an accepted change through the
  Land Queue (see [Landing a change](#landing-a-change)).
- **Bug reports, feature requests and questions** go to the
  [ZotLit forum](https://zotlit-forum.aidenlx.site). GitHub Issues in
  `aidenlx/zotlit-repo` hold the defects a maintainer has confirmed.

## Development flow

```text
mise run init                                    once per clone: dependencies, generated types
wt switch --create fix/<topic> --base origin/main   one worktree per change
  edit, commit                                   pre-commit: format, lint, messages
  pnpm verify                                    format, lint (the typecheck), tests of the
                                                 changed packages and their dependents
pnpm land                                        rebase, squash, verify --local, record PR,
                                                 wait for its CI tests, fast-forward main
wt remove fix/<topic>
```

The root [`AGENTS.md`](AGENTS.md) is the reference for each step, for people
and agents alike:

| Step                         | Read                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Toolchain and first setup    | `AGENTS.md` "Bootstrap & toolchain"                                                              |
| Where code goes              | `AGENTS.md` "Repo shape", then the `AGENTS.md` of the app or package: lint enforces their layers |
| Worktrees and scratch files  | `AGENTS.md` "Worktrees" and "Working files"                                                      |
| Checks and tests             | `AGENTS.md` "Commands" and "Testing"; `packages/e2e/AGENTS.md` for the End-to-end Run            |
| Landing, the queue, failures | `AGENTS.md` "Landing a change"                                                                   |
| Decisions and their reasons  | `docs/adr/`                                                                                      |

The gate is `pnpm verify`. `pnpm land` runs `pnpm verify --local` on the tree
it pushes, and the record pull request of the land runs `pnpm verify --pr` in
CI before `main` moves
([ADR 0076](docs/adr/0076-checks-run-before-push-and-ci-runs-only-to-release.md),
[ADR 0084](docs/adr/0084-changes-land-on-next-through-a-serial-queue.md),
[ADR 0102](docs/adr/0102-each-land-opens-a-record-pull-request.md)).

Use `pnpm e2e` for functional checks. Read timing measurements in the run evidence or the GitHub artifact. For a performance change or a timing regression, use the optional `pnpm e2e:performance` command on the reference MacBook. [Reference machine and run conditions](docs/adr/0116-e2e-timing-limits-use-a-reference-machine.md#reference-baseline)

### Branching model

`main` is the one long-lived branch of `aidenlx/zotlit-repo`. Every change
lands on it, and every release, beta or stable, is a version commit on it. The
version picks the release line: a pre-release version (`2.3.0-beta.1`) ships
on the beta line, any other version (`2.3.0`) on the stable line. The code of
a release is its tag. A land pushes its task branch to `aidenlx/zotlit-repo` as
the head of its record pull request, and deletes it once the PR shows as
merged. See
[ADR 0097](docs/adr/0097-main-is-the-one-trunk.md) and
[ADR 0102](docs/adr/0102-each-land-opens-a-record-pull-request.md).

### Landing a change

A change reaches `main` through `pnpm land`, run from the task worktree on its
branch with a clean tree. Lands on one machine run one at a time, in a queue:
each fetches `origin/main`, rebases the branch, and creates one commit using
the record title and body. It installs the
dependencies when the rebase changed a lockfile or manifest, runs
`pnpm verify --local` on the rebased tree, pushes the branch and opens or
updates its record pull request from the record file, waits for the CI check
of the PR (`pnpm verify --pr`), and dispatches the landing workflow on `main`.
The workflow checks the PR, CI result, and the attribution and Conventional Commits subject of each incoming commit.
The landing App fast-forwards `main` to the verified commit. A failed check fails the land, and `main` stays as it was.
GitHub then shows the PR as merged. `pnpm land --help` names the record file
and its sections. `pnpm land --no-verify` skips the gate; the CI check
still runs. Use `pnpm land --no-squash` to preserve the rebased commits. Every commit that reaches `main` has a [Conventional Commits](https://www.conventionalcommits.org/) subject: the record title for a squash land, each commit subject for `--no-squash`. Releases preserve their version commit.

### Landing App

1. Install a dedicated GitHub App on the source repository only. Grant write
   access to Contents and Workflows so the App can land workflow changes.
2. Create the GitHub Actions environment `land`. Under deployment branches
   and tags, select only the branch `main`. Set the environment variable
   `LAND_APP_ID` and environment secret `LAND_APP_PRIVATE_KEY` there.
3. Bootstrap the workflow onto `main` through the previous land command.
   Land one reviewed change with the new command. Confirm that the landing run
   succeeded and that the record PR head is the commit on `main`.
4. Activate a separate branch ruleset targeting `main` with **Restrict updates**.
   Give only the landing App an **Always allow** bypass on this ruleset.
   Keep force-push and deletion protection in their existing ruleset.
   Verify that GitHub lists the update restriction for `main` and that the App
   is its only bypass actor.

## Releasing

The source lives in `aidenlx/zotlit-repo`. Releases publish to the publish
repository `aidenlx/zotlit`: the plugin releases, the Resource Releases, the
Companion releases and its `zotero-release` update channel. Code reads the two
names from `packages/config/src/core/repositories.ts`. The publish repository holds a
generated shell that builds the plugin from the npm bundle package
([ADR 0095](docs/adr/0095-the-publish-repository-is-a-thin-generated-shell.md)).

Each app's `apps/{app}/package.json#version` is the sole version source.

| Product                             | Tag format          | Example                                     |
| ----------------------------------- | ------------------- | ------------------------------------------- |
| Obsidian (`@zotlit/obsidian`)       | bare semver         | `2.0.0`, `2.1.0-beta.1`                     |
| Zotero (`@zotlit/zotero`)           | `zt-` prefix        | `zt-2.0.0`, `zt-2.1.0-beta.1`               |
| Reader (`@zotlit/reader`)           | `reader-` prefix    | `reader-1.0.0`, `reader-1.0.0-beta.0`       |
| Resource Pack (`@zotlit/resources`) | `resources-` prefix | `resources-1.0.0`, `resources-1.0.0-beta.0` |

Both repositories carry the tags of ZotLit and the Companion. In
`aidenlx/zotlit-repo` a tag names the commit the release was built from; in
`aidenlx/zotlit` it names the shell commit (plugin) or the release
(Companion). ZotLit Reader publishes to its own publish repository,
`aidenlx/zotlit-reader`, and the npm bundle package `@zotlit/reader-plugin`:
`aidenlx/zotlit-repo` tags `reader-<version>` on the source commit, and
`aidenlx/zotlit-reader` tags the bare version on the shell commit. The
Resource Pack does the same with `aidenlx/zotlit-resources`,
`@zotlit/resources-plugin` and the source tag `resources-<version>`.

### Version policy

Each version is greater than the version before it on `main`. A stable
release (`2.3.0`) follows the betas of its version (`2.3.0-beta.N`); the next
beta cycle starts from it (`2.4.0-beta.0`). A stable hotfix (`2.3.1`) is a
patch of the latest stable release; `release:publish` refuses any other
version from a commit that `main` lacks.

The Resource Pack has its own version line, apart from ZotLit's, and its
version picks its release line as for each product. Its line follows the
ZotLit release that builds it: a version commit that releases ZotLit and the
pack takes both versions on one line, a pre-release pack version in a beta of
ZotLit and a stable pack version in a stable release. `pnpm release` offers
the pack the bumps of ZotLit's line and refuses versions on two lines. A pack
released alone ships on the line of its own version.

The compatibility integer of the pack (`PACK_COMPAT` in
`packages/resource-pack/src/format.ts`) is not a version. It changes only when
the container format or the meaning of an entry changes; a new version of a
binary with the same interface keeps it.

### How to release

```text
person          pnpm release ─▶ version commit ─▶ Land Queue ─▶ main
                                (release gate in the Land Turn)
aidenlx/zotlit-repo  release.yml on the push to main:
                plan ─▶ verify ─▶ obsidian: npm ─▶ shell commit + tag ─▶ tag here
                               ├▶ zotero:   zt-<v> release ─▶ update channel ─▶ tag here
                               ├▶ reader:   npm ─▶ shell commit + tag ─▶ reader-<v> here
                               └▶ resources: npm ─▶ shell commit + tag ─▶ resources-<v> here
aidenlx/zotlit, aidenlx/zotlit-reader  plugin-release.yml of the shell, on the tag:
                official Obsidian action ─▶ res-<v> ─▶ publish the release
aidenlx/zotlit-resources  plugin-release.yml of the shell, on the tag:
                official Obsidian action ─▶ publish the release
```

1. Check out `main` at the tip of `origin/main`, with a clean tree.
2. Run `pnpm release`. The interactive script bumps the versions, syncs the
   root `manifest.json` and `versions.json` for a stable plugin release,
   refreshes the lockfile, commits on a local release branch, and lands that
   version commit through the Land Queue and record PR. The landing App
   advances `main` to that commit after CI passes. The release gate
   (`pnpm verify --release`) runs once in the Land Turn on the tree that is
   pushed. The End-to-end Run needs Docker. The start-up measurement uses
   the host Obsidian and an awake, unlocked display.

   To release without prompts, name each app and its version: a bump that the
   current version offers, or an explicit version.

   ```sh
   pnpm release --obsidian prerelease --zotero prerelease   # the next beta
   pnpm release --obsidian 2.3.0-beta.0 --zotero 2.3.0-beta.0
   pnpm release --obsidian minor --zotero minor             # a stable release
   pnpm release --reader prerelease                         # the next Reader beta
   pnpm release --resources prerelease                      # the next Resource Pack beta
   pnpm release --obsidian prerelease --resources prerelease  # a ZotLit beta with a new pack
   ```

   On a failure the script deletes its release branch and returns to `main`.

3. `release.yml` in `aidenlx/zotlit-repo` runs on the push. Its `plan` job
   publishes each product whose `publish` switch in
   `packages/scripts/lib/release/lines.ts` is on and whose version has no
   release tag in
   `aidenlx/zotlit-repo` yet. The `verify` job runs the release gate on the
   pushed tree (the desktop checks skip there). Then each product runs
   `pnpm release:publish <product>`:
   - **Obsidian:** production build with the docs site of the line, the npm
     bundle package (dist-tag `beta` or `latest`, with provenance), the shell
     with its lockfile resolved from npm, a frozen install and build in a
     clean folder that must reproduce the app's `main.js` and `styles.css`,
     the shell commit on `beta` or `main` of `aidenlx/zotlit` with the version
     tag (one atomic push), and the tag in `aidenlx/zotlit-repo`.
   - **Reader:** the same steps as Obsidian, for `apps/reader`: the npm
     bundle package `@zotlit/reader-plugin`, the shell commit and the bare
     version tag in `aidenlx/zotlit-reader`, and the tag `reader-<version>`
     in `aidenlx/zotlit-repo`. A stable Reader release also writes
     `apps/reader/versions.json` in step 2.
   - **Resource Pack:** the same steps as Obsidian, for `apps/resources`:
     the npm bundle package `@zotlit/resources-plugin`, the shell commit and
     the bare version tag in `aidenlx/zotlit-resources`, and the tag
     `resources-<version>` in `aidenlx/zotlit-repo`. The pack's `main.js`
     holds its data files at byte offsets, so its build, its npm package and
     its shell copy the file byte for byte: the shell has no bundler, and the
     check compares `main.js` alone. A stable pack release also writes
     `apps/resources/versions.json` in step 2.
   - **Companion:** the XPI on the release `zt-<version>`, the update
     manifests on `zotero-release`, and the tag in `aidenlx/zotlit-repo`.
   - **Docs:** no job deploys the production docs site. After the release
     lands, run `pnpm site:release --to` (the `site-release` skill).
4. The tag starts the shell's own `plugin-release.yml` in the publish
   repository (`aidenlx/zotlit`, `aidenlx/zotlit-reader` or
   `aidenlx/zotlit-resources`). It runs
   the official Obsidian action (scanner lint, attestation, draft release),
   creates and checks the Resource Release `res-<version>`, and publishes the
   release (a pre-release for a beta). The Resource Pack downloads nothing at
   runtime, so its workflow makes no Resource Release. See
   [docs/CI_SETUP.md](docs/CI_SETUP.md#release-workflow).

`pnpm release:publish <product> --dry-run [--version <v>]` runs the whole
publish with local stand-ins and prints the commands a real run executes.

### Release cycle

1. **Start the beta.** On `main`, run `pnpm release`, pick
   `preminor` → `2.4.0-beta.0`.
2. **Iterate.** Land changes onto `main` with `pnpm land`. Run `pnpm release`
   with `prerelease` → `2.4.0-beta.1`, `.2`, …
3. **Ship stable.** On `main`, run `pnpm release` and pick `minor` → `2.4.0`.
   `release.yml` publishes it on the stable line and deploys the production
   docs site from the tag `2.4.0`.
4. **Start the next beta.** Run `pnpm release` on `main` with `preminor` →
   `2.5.0-beta.0`.

### Stable hotfix

A stable patch (a security fix, a regression) normally ships as a stable
release from `main`. When `main` holds unfinished work that must not ship, cut
the fix from the latest stable release instead. The hotfix commits reach
`aidenlx/zotlit-repo` through the release tag alone; no branch other than
`main` is pushed there.

1. Cut a local branch from the latest stable release tag, and make the fix:

   ```sh
   git fetch origin --tags
   wt switch --create hotfix/2.3.1 --base 2.3.0
   # commit the fix
   ```

2. Commit the version on the same branch: set `version` in
   `apps/obsidian/package.json` (and `apps/zotero/package.json` when the
   Companion ships too) to the patch version, set the same `version` in the
   root `manifest.json`, add it to the root `versions.json` with the
   manifest's `minAppVersion`, run `pnpm install --lockfile-only`, and commit
   `chore: release obsidian@2.3.1`.
3. Run the release gate on that commit: `pnpm verify --release`.
4. With a clean tree on that commit, publish each product:

   ```sh
   pnpm release:publish obsidian --dry-run   # read its output
   pnpm release:publish obsidian
   pnpm release:publish zotero               # when the Companion ships too
   ```

   `release:publish` takes a commit that `origin/main` lacks only for a
   stable version that is a patch of the latest stable release, greater than
   it, on a commit that descends from that release's tag. The release tag it
   pushes to `aidenlx/zotlit-repo` carries the hotfix commits.

5. Land the fix onto `main` separately: on a task branch off `origin/main`,
   cherry-pick the fix commits (not the version commit), add the hotfix
   version to the root `versions.json`, so the next stable shell lists it, and
   run `pnpm land`. Then remove the hotfix worktree with
   `wt remove hotfix/2.3.1`.
6. Land the changelog entry of the hotfix as a record PR of its own, and put
   it on the production docs site with `pnpm site:release --pick <record PR>`
   (the `site-release` skill). The site never builds from the hotfix tag.

### ZotLit and ZotLit Reader

ZotLit's annotation tools come with ZotLit Reader: ZotLit adds them to the
Reader's view. Before you start a ZotLit release, check this item:

- [ ] A ZotLit release that has no overlay on Obsidian's PDF view waits until the community directory lists ZotLit Reader.

The release order is: a ZotLit Reader beta on BRAT, then the community
directory listing of ZotLit Reader, then that ZotLit release.

ZotLit Reader `1.0.0-beta.0` proved the Reader's release pipeline. The Reader
is still in development: the next Reader release comes when the maintainer
says so, and fixes land on `main` as normal changes.

### Distribution channels

| Channel     | Obsidian                                             | Zotero                                         |
| ----------- | ---------------------------------------------------- | ---------------------------------------------- |
| Pre-release | [BRAT](https://github.com/TfTHacker/obsidian42-brat) | `update-beta.json` on the `zotero-release` tag |
| Stable      | Community plugin store + BRAT                        | `update.json` on the `zotero-release` tag      |

### First release of a new plugin

A plugin's npm bundle package does not exist before its first release, so
trusted publishing cannot be set for it yet. That one release publishes from
the lead's machine, logged in to npm as the owner of the scope, while the
`Release` workflow is disabled. The desktop plugin's first release in this
flow was `2.3.0-beta.0`. ZotLit Reader's was `1.0.0-beta.0`: product `reader`,
source tag `reader-1.0.0-beta.0`, publish repository `aidenlx/zotlit-reader`,
npm bundle package `@zotlit/reader-plugin`, on BRAT. The Resource Pack's
first release is open: product `resources`, source tag
`resources-1.0.0-beta.0`, publish repository `aidenlx/zotlit-resources`, npm
bundle package `@zotlit/resources-plugin`. Its publish repository exists and
its `publish` switch is on; the first npm publish (step 3) is open.

1. Add the plugin to `PUBLISHED_PLUGINS`
   (`packages/scripts/lib/shell/plugins.ts`) with the profile of its kind
   (`profiles.ts` beside it), its product to `PRODUCTS`
   (`packages/scripts/lib/release/lines.ts`) with the `publish` switch off,
   and its publish job to `release.yml`. Create the publish repository and do
   the settings in
   [docs/CI_SETUP.md](docs/CI_SETUP.md#settings-outside-the-repository) that
   come before a first publish.
2. Disable the `Release` workflow in `aidenlx/zotlit-repo`
   (`gh workflow disable Release -R aidenlx/zotlit-repo`), so that the push
   to `main` starts no publish from CI. Then land the commit that turns the
   product's `publish` switch on, with the app at its first version: with
   `pnpm land` when the app already holds that version (`apps/reader` started
   at `1.0.0-beta.0`), else in the version commit of `pnpm release`.
3. On that commit of `origin/main`, with a clean tree, run
   `pnpm release:publish <product> --dry-run`, read its output, then
   `pnpm release:publish <product>` with an npm one-time password (OTP): pass
   the code as `npm_config_otp=<code>` in front of the command, or run it in
   a terminal that npm can prompt in. The run publishes the npm package
   without provenance, pushes the shell commit and the version tag to the
   publish repository, and pushes the source tag here. GitHub starts the
   tag's run only when `main` holds the shell's
   `.github/workflows/plugin-release.yml`. When `main` of the new publish
   repository has no files, the same atomic push also fast-forwards `main`
   to the shell commit; the dry run names `main` in its `push` step. So a
   new plugin's `main` holds its first beta shell until its first stable
   release. If GitHub still lists no "Plugin release" workflow and starts no
   run, delete the version tag in the publish repository and push it again
   on the same commit.
4. Watch the shell's `plugin-release.yml` in the publish repository publish
   the release and its Resource Release.
5. Set trusted publishing for the npm package from the lead's machine, each
   npm command with an OTP (docs/CI_SETUP.md):

   ```sh
   npm trust github <bundle package> --repo aidenlx/zotlit-repo --file release.yml --allow-publish -y
   npm access set mfa=publish <bundle package>
   ```

   Then check "Require two-factor authentication and disallow tokens" on the
   package's settings page on npmjs.com, and enable the `Release` workflow
   again with `gh workflow enable Release -R aidenlx/zotlit-repo`. Later
   releases publish from `release.yml`.

### A step failed half way

Every step of `pnpm release:publish` finds what an earlier run did, so the
first action is to run the same publish again: re-run the failed job, or run
`release.yml` with `workflow_dispatch` on `main`. A stable hotfix runs
`pnpm release:publish` again on its commit.

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

The Companion `update channel` step uploads only the update manifests it
changed. It stops before an upload when another publish put a newer version on
that channel after this run downloaded it. Run the publish again: the new run
builds on the current channel.

A release whose fix needs a new version can leave an orphan `res-<version>`
or a draft in `aidenlx/zotlit`, and a version on npm that no release uses
(`npm deprecate` it). Delete the orphan release by hand.
