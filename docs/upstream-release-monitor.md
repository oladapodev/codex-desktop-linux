# Upstream Release Monitor

This fork can watch `ilysenko/codex-desktop-linux`, build packages from open
upstream pull requests for testing, and publish stable packages after upstream
changes reach `main`.

The automation lives in two workflows:

- `.github/workflows/upstream-release-monitor.yml` discovers changes, syncs
  stable upstream commits, publishes stable releases, and maintains the status
  issue.
- `.github/workflows/upstream-preview-build.yml` is a reusable workflow that
  separates execution of unmerged code from release publication.

## Schedule And Discovery

The monitor runs at minutes 7, 22, 37, and 52 of every hour. It can also be run
manually from GitHub Actions. Each run reads all currently open upstream PRs and
selects at most four head SHAs that do not already have a preview result. Two
preview packages can build concurrently.

Polling records the latest head SHA visible during each run. If several pushes
land on one PR between polls, GitHub exposes only the newest head to the next
run, so intermediate SHAs are not promised a build.

## Preview Releases

Preview releases use this tag format:

```text
preview-pr-<number>-<12-character-head-sha>
```

They are marked as GitHub prereleases and use a Debian version like:

```text
2026.07.12.120000~preview.pr123.abcdef12
```

The build fetches the exact public `refs/pull/<number>/head` commit without
persisting a repository credential. It receives no repository secrets and
cannot publish a release. A separate trusted job validates the resulting
Debian file, writes release notes from GitHub API data, and uploads it.

Preview packages contain unmerged code. Treat them as untrusted test builds,
review the upstream PR, and do not install them on a machine where experimental
code is unacceptable.

Only the newest successful preview asset for each PR is retained. A failed
build creates an asset-free prerelease at the deterministic preview tag, which
prevents the same broken SHA from rebuilding every 15 minutes. Closed and
merged PR previews are removed after a stable release is available.

## Stable Releases

When upstream `main` advances, a trusted job merges the exact upstream commit
into the fork without force-pushing. GitHub CI then builds the package from the
synced fork commit. After a successful build, a separate trusted job creates a
normal release, marks it latest, and retains it permanently.

Stable tags are deterministic:

```text
v<upstream-commit-UTC-timestamp>-<12-character-upstream-sha>
```

Release notes include the upstream comparison, associated merged PRs, all
commits, upstream and fork SHAs, package version, and workflow-run link.

If sync or build fails, no stable release is created. The managed status issue
shows the failed job, and the next scheduled run retries the missing stable
tag.

## Manual Preview Rebuild

Open **Actions**, select **Monitor Upstream Releases**, and choose **Run
workflow**. Set `pr_number` to one currently open upstream PR. Enable
`force_preview` to replace the preview for that exact head SHA after a failed or
stale result.

The equivalent GitHub CLI command is:

```bash
gh workflow run upstream-release-monitor.yml \
  -f pr_number=123 \
  -f force_preview=true
```

## Repository Permissions

The repository's Actions workflow permissions must allow read and write access
so trusted publisher jobs can create releases and update the monitor issue.

The sync job uses the repository `GITHUB_TOKEN` by default. If GitHub refuses a
sync because the upstream merge changes `.github/workflows/`, create a
fine-grained token allowed to write repository contents and workflows, then add
it as the repository secret `UPSTREAM_SYNC_TOKEN`. Preview build jobs never
receive this token.

Scheduled workflows can be disabled from the workflow's menu in GitHub Actions.
Manual dispatch remains available while the workflow itself is enabled.

## Activity Issue

One managed issue titled `Upstream PR and release monitor` lists:

- the current upstream `main` SHA;
- the stable release for that SHA;
- preview and stable job results;
- the selected preview queue size;
- every currently open upstream PR, its latest head SHA, and whether its
  preview is queued, ready, or failed.

The workflow updates only an issue containing its hidden ownership marker. It
does not take over a maintainer-created issue that happens to use the same
label.
