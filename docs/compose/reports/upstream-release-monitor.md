---
feature: upstream-release-monitor
status: delivered
specs:
  - docs/compose/specs/2026-07-12-upstream-release-monitor-design.md
plans:
  - docs/compose/plans/2026-07-12-upstream-release-monitor.md
branch: main
commits: b7c5123..7c5f8e7
---

# Upstream Release Monitor - Final Report

## What Was Built

The fork now polls `ilysenko/codex-desktop-linux` four times per hour, syncs
new upstream `main` commits without force-pushing, and publishes a validated
Debian package as a normal GitHub release marked latest. Stable release notes
record the upstream range, merged pull requests, individual commits, fork and
upstream SHAs, package version, and originating workflow run.

Open upstream pull-request heads are built as clearly marked prereleases for
testing. Each preview identifies the PR and exact unmerged SHA, and only the
newest successful preview for a PR is retained. Failed preview SHAs receive an
asset-free marker so the schedule does not repeatedly rebuild known failures;
a manual force run can retry them.

## Architecture

`.github/workflows/upstream-release-monitor.yml` owns trusted discovery,
bounded scheduling, upstream synchronization, stable builds and publishing,
preview cleanup, and status reporting. Discovery selects at most four unseen
PR heads per run, while the preview matrix allows at most two concurrent
builds.

`.github/workflows/upstream-preview-build.yml` enforces the unmerged-code trust
boundary. Its read-only build job fetches the exact public PR ref without
credentials and uploads one validated short-lived artifact. A separate trusted
job downloads but never executes that package, validates its checksum and
Debian metadata, generates notes from trusted code, and publishes it.

`scripts/ci/upstream-release-monitor.js` contains the tested naming, selection,
pagination, release-note, retention, and dashboard logic. The dashboard is a
managed issue when Issues are enabled; otherwise the same content is written
to the Actions run summary without failing the run.

### Design Decisions

We chose deterministic tags based on source SHAs because reruns can detect
already handled source without maintaining a separate database. We bounded
the initial PR backlog because each build downloads or restores a large DMG
and compiles native components. We kept release credentials out of unmerged
code execution because upstream PR code is not trusted until merge.

## Usage

Normal operation is automatic at minutes `7`, `22`, `37`, and `52` of every
hour. Stable packages appear under GitHub Releases with tags like
`v2026.07.12.103137-efcd704466a4`; previews use tags like
`preview-pr-885-f274f5ecec3e` and are marked prerelease.

To retry one current PR head, open **Actions**, select **Monitor Upstream
Releases**, choose **Run workflow**, set `pr_number`, and enable
`force_preview`. Operational details and retention rules are in
`docs/upstream-release-monitor.md`.

## Verification

The lightweight local suite passed all 36 tests across the existing upstream
CI helpers and the new monitor tests. The monitor module passed Node syntax
checking, both workflow files parsed as YAML, and `git diff --check` was clean.
No Cargo or package build was run locally.

GitHub Actions run `29188557508` built the initial stable package and four PR
previews. Its only failure was status issue creation because Issues are
disabled on the fork. Run `29189265736` verified the fallback fix end to end:
upstream sync, stable build and latest release, PR `#885` and `#815` preview
builds and prereleases, and the Actions-summary dashboard all completed
successfully.

## Journey Log

> Brief notes on what informed the final design. Not required reading.

- [pivot] Workflow dispatch was not required for bootstrap; a narrow push trigger started the first monitor run while leaving scheduled operation unchanged.
- [lesson] A repository may grant `issues: write` while its Issues feature is disabled, which returns HTTP 410 and needs an explicit summary fallback.
- [lesson] Reusable workflow permissions cannot be elevated beyond the caller, so the caller grants publication access and the untrusted job explicitly downgrades itself to read-only.
- [lesson] Pushes made by `GITHUB_TOKEN` do not recursively trigger push workflows, so sync, build, and publication stay in one orchestration run.

## Source Materials

| File | Role | Notes |
| --- | --- | --- |
| `docs/compose/specs/2026-07-12-upstream-release-monitor-design.md` | Design | Release classes, security boundary, retention, and reporting requirements |
| `docs/compose/plans/2026-07-12-upstream-release-monitor.md` | Implementation plan | Tested helper, two workflows, documentation, and CI verification |
| `docs/upstream-release-monitor.md` | Operator guide | Schedule, manual retries, release naming, permissions, and retention |
