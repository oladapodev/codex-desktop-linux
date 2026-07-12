"use strict";

const LABEL = "upstream-release-monitor";
const ISSUE_MARKER = "<!-- upstream-release-monitor -->";
const PREVIEW_TAG_PATTERN = /^preview-pr-(\d+)-([a-f0-9]{12})$/;
const STABLE_MARKER_PATTERN = /<!-- upstream-stable:([a-f0-9]{40}) -->/i;
const SHA_PATTERN = /^[a-f0-9]{40}$/i;

function requirePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireSha(value, name = "SHA") {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new Error(`${name} must be a 40-character hexadecimal SHA`);
  }
  return value.toLowerCase();
}

function previewTag(prNumber, headSha) {
  const number = requirePositiveInteger(prNumber, "PR number");
  const sha = requireSha(headSha, "PR head SHA");
  return `preview-pr-${number}-${sha.slice(0, 12)}`;
}

function stableTag(committedAt, headSha) {
  const date = new Date(committedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Upstream commit timestamp is invalid");
  }
  const sha = requireSha(headSha, "Upstream head SHA");
  const stamp = date.toISOString().replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).*$/, "$1.$2.$3.$4$5$6");
  return `v${stamp}-${sha.slice(0, 12)}`;
}

function releaseTags(releases) {
  return new Set(releases.map((release) => release.tag_name).filter(Boolean));
}

function selectPreviewCandidates({
  pulls,
  releases,
  limit = 4,
  requestedPrNumber = null,
  force = false,
}) {
  const parsedLimit = requirePositiveInteger(limit, "Preview limit");
  if (force && (requestedPrNumber === null || requestedPrNumber === undefined || requestedPrNumber === "")) {
    throw new Error("Force preview requires a requested PR number");
  }
  const openPulls = pulls
    .filter((pull) => pull.state === "open")
    .slice()
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  const tags = releaseTags(releases);

  let candidates = openPulls;
  if (requestedPrNumber !== null && requestedPrNumber !== undefined && requestedPrNumber !== "") {
    const requested = requirePositiveInteger(requestedPrNumber, "Requested PR number");
    candidates = openPulls.filter((pull) => pull.number === requested);
    if (candidates.length === 0) {
      throw new Error(`#${requested} is not an open upstream PR`);
    }
  }

  return candidates
    .map((pull) => {
      const headSha = requireSha(pull.head?.sha, `PR #${pull.number} head SHA`);
      return {
        prNumber: requirePositiveInteger(pull.number, "PR number"),
        baseSha: requireSha(pull.base?.sha, `PR #${pull.number} base SHA`),
        headSha,
        tag: previewTag(pull.number, headSha),
      };
    })
    .filter((candidate) => force || !tags.has(candidate.tag))
    .slice(0, requestedPrNumber ? 1 : parsedLimit);
}

function latestStableUpstreamSha(releases) {
  const marked = releases
    .filter((release) => !release.prerelease && !release.draft)
    .map((release) => ({
      publishedAt: release.published_at ?? release.created_at ?? "",
      sha: release.body?.match(STABLE_MARKER_PATTERN)?.[1]?.toLowerCase() ?? null,
    }))
    .filter((release) => release.sha !== null)
    .sort((left, right) => String(right.publishedAt).localeCompare(String(left.publishedAt)));
  return marked[0]?.sha ?? null;
}

function previewTagsToDelete({ releases, prNumber, keepTag }) {
  const number = requirePositiveInteger(prNumber, "PR number");
  return releases
    .map((release) => release.tag_name)
    .filter((tag) => {
      const match = tag?.match(PREVIEW_TAG_PATTERN);
      return match && Number(match[1]) === number && tag !== keepTag;
    })
    .sort();
}

function staleClosedPreviewTags({ releases, openPulls }) {
  const openNumbers = new Set(openPulls.map((pull) => requirePositiveInteger(pull.number, "PR number")));
  return releases
    .map((release) => release.tag_name)
    .filter((tag) => {
      const match = tag?.match(PREVIEW_TAG_PATTERN);
      return match && !openNumbers.has(Number(match[1]));
    })
    .sort();
}

function oneLine(value) {
  return String(value ?? "").split(/\r?\n/, 1)[0].trim().replace(/\s+/g, " ");
}

function tableText(value) {
  return oneLine(value).replace(/\|/g, "\\|");
}

function authorName(item) {
  return item?.user?.login ?? item?.author?.login ?? item?.commit?.author?.name ?? "unknown";
}

function pullLabels(pull) {
  const labels = (pull.labels ?? []).map((label) => oneLine(label.name)).filter(Boolean);
  return labels.length > 0 ? ` (labels: ${labels.map((label) => `\`${label}\``).join(", ")})` : "";
}

function commitLines(commits) {
  if (commits.length === 0) return ["- No commits were returned by the GitHub API."];
  return commits.map((commit) => {
    const currentSha = requireSha(commit.sha, "Commit SHA");
    const subject = oneLine(commit.commit?.message) || "Untitled commit";
    const link = commit.html_url ?? `https://github.com/commit/${currentSha}`;
    return `- [\`${currentSha.slice(0, 12)}\`](${link}) ${subject} (@${authorName(commit)})`;
  });
}

function formatPreviewNotes({
  upstreamRepository,
  pull,
  commits,
  packageVersion,
  runUrl,
}) {
  const number = requirePositiveInteger(pull.number, "PR number");
  const headSha = requireSha(pull.head?.sha, "PR head SHA");
  const title = oneLine(pull.title) || `PR #${number}`;
  const lines = [
    `<!-- upstream-preview:${number}:${headSha} -->`,
    "> **Warning:** This package contains UNMERGED upstream code. Use it only for testing and exploration.",
    "",
    "## Source",
    "",
    `- Upstream PR: [#${number} ${title}](${pull.html_url})`,
    `- Author: @${authorName(pull)}`,
    `- Labels: ${(pull.labels ?? []).map((label) => `\`${oneLine(label.name)}\``).join(", ") || "none"}`,
    `- Head SHA: \`${headSha}\``,
    `- Upstream repository: [${upstreamRepository}](https://github.com/${upstreamRepository})`,
    `- Package version: \`${packageVersion}\``,
    `- Build run: [open workflow run](${runUrl})`,
    "",
    "## Commits",
    "",
    ...commitLines(commits),
  ];
  return `${lines.join("\n")}\n`;
}

function formatStableNotes({
  upstreamRepository,
  baseSha,
  headSha,
  forkSha,
  pulls,
  commits,
  packageVersion,
  runUrl,
}) {
  const base = requireSha(baseSha, "Upstream base SHA");
  const head = requireSha(headSha, "Upstream head SHA");
  const fork = requireSha(forkSha, "Fork release SHA");
  const compareUrl = `https://github.com/${upstreamRepository}/compare/${base}...${head}`;
  const pullLines = pulls.length === 0
    ? ["- No associated pull requests were found; see the commit list below."]
    : pulls
      .slice()
      .sort((left, right) => left.number - right.number)
      .map((pull) => `- [#${pull.number} ${oneLine(pull.title)}](${pull.html_url}) (@${authorName(pull)})${pullLabels(pull)}`);
  const lines = [
    `<!-- upstream-stable:${head} -->`,
    "Stable Linux build from changes merged into upstream `main`.",
    "",
    "## Provenance",
    "",
    `- [Compare upstream changes](${compareUrl})`,
    `- Upstream range: \`${base.slice(0, 12)}..${head.slice(0, 12)}\``,
    `- Fork release SHA: \`${fork}\``,
    `- Package version: \`${packageVersion}\``,
    `- Build run: [open workflow run](${runUrl})`,
    "",
    "## Merged upstream pull requests",
    "",
    ...pullLines,
    "",
    "## Commits",
    "",
    ...commitLines(commits),
  ];
  return `${lines.join("\n")}\n`;
}

function currentPreviewRelease(pull, releases) {
  const tag = previewTag(pull.number, pull.head?.sha);
  return releases.find((release) => release.tag_name === tag) ?? null;
}

function previewStatus(pull, releases) {
  const current = currentPreviewRelease(pull, releases);
  if (!current) return "queued";
  const label = current.assets?.length > 0 ? "ready" : "failed";
  return current.html_url ? `[${label}](${current.html_url})` : label;
}

function dashboardBody({
  upstreamRepository,
  upstreamHeadSha,
  stableRelease,
  pulls,
  releases,
  queuedCount,
  runUrl,
  stableResult,
  previewResult,
}) {
  const head = requireSha(upstreamHeadSha, "Upstream head SHA");
  const sortedPulls = pulls
    .filter((pull) => pull.state === "open")
    .slice()
    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)));
  const stable = stableRelease
    ? `[${stableRelease.tag_name}](${stableRelease.html_url})`
    : "not published for current upstream head";
  const lines = [
    ISSUE_MARKER,
    "Automated status for upstream pull-request previews and stable Linux releases.",
    "",
    "## Current status",
    "",
    `- Upstream: [${upstreamRepository}](https://github.com/${upstreamRepository})`,
    `- Upstream main: \`${head}\``,
    `- Stable release: ${stable}`,
    `- Stable job: \`${stableResult}\``,
    `- Preview jobs: \`${previewResult}\``,
    `- Preview queue selected this run: \`${Number(queuedCount) || 0}\``,
    `- Workflow run: [open run](${runUrl})`,
    "",
    `## Open upstream pull requests (${sortedPulls.length})`,
    "",
    "| PR | Title | Author | Head | Preview | Updated |",
    "| --- | --- | --- | --- | --- | --- |",
    ...sortedPulls.map((pull) => [
      `[#${pull.number}](${pull.html_url})`,
      tableText(pull.title),
      `@${tableText(authorName(pull))}`,
      `\`${requireSha(pull.head?.sha, `PR #${pull.number} head SHA`).slice(0, 12)}\``,
      previewStatus(pull, releases),
      tableText(pull.updated_at),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
  ];
  if (sortedPulls.length === 0) lines.push("| - | No open upstream PRs | - | - | - | - |");
  return `${lines.join("\n")}\n`;
}

async function paginate(github, method, params) {
  if (github.paginate) return github.paginate(method, params);
  return (await method(params)).data;
}

async function listOpenPulls(github, repo) {
  return paginate(github, github.rest.pulls.list, {
    ...repo,
    state: "open",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  });
}

async function listReleases(github, repo) {
  return paginate(github, github.rest.repos.listReleases, { ...repo, per_page: 100 });
}

async function listPullCommits(github, repo, pullNumber) {
  return paginate(github, github.rest.pulls.listCommits, {
    ...repo,
    pull_number: requirePositiveInteger(pullNumber, "PR number"),
    per_page: 100,
  });
}

async function compareCommits(github, repo, baseSha, headSha) {
  const basehead = `${requireSha(baseSha, "Base SHA")}...${requireSha(headSha, "Head SHA")}`;
  const commits = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await github.rest.repos.compareCommitsWithBasehead({
      ...repo,
      basehead,
      per_page: 100,
      page,
    });
    const current = response.data.commits ?? [];
    commits.push(...current);
    if (current.length < 100) return commits;
  }
  throw new Error("Upstream comparison exceeded 10,000 commits");
}

function pullNumbersFromCommits(commits) {
  const numbers = new Set();
  for (const commit of commits) {
    const message = String(commit.commit?.message ?? "");
    for (const pattern of [/\(#(\d+)\)/g, /Merge pull request #(\d+)/g]) {
      for (const match of message.matchAll(pattern)) numbers.add(Number(match[1]));
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

async function loadPullsByNumber(github, repo, numbers) {
  const pulls = [];
  for (const number of numbers) {
    try {
      const response = await github.rest.pulls.get({ ...repo, pull_number: number });
      pulls.push(response.data);
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  return pulls;
}

async function ensureLabel(github, repo) {
  try {
    await github.rest.issues.getLabel({ ...repo, name: LABEL });
  } catch (error) {
    if (error?.status !== 404) throw error;
    await github.rest.issues.createLabel({
      ...repo,
      name: LABEL,
      color: "1f6feb",
      description: "Tracks upstream PR previews and stable releases",
    });
  }
}

async function reconcileMonitorIssue({ github, repo, snapshot }) {
  await ensureLabel(github, repo);
  const issues = await paginate(github, github.rest.issues.listForRepo, {
    ...repo,
    state: "all",
    labels: LABEL,
    per_page: 100,
  });
  const owned = issues.find((issue) => issue.pull_request == null && issue.body?.includes(ISSUE_MARKER));
  const title = "Upstream PR and release monitor";
  const body = dashboardBody(snapshot);
  if (owned) {
    await github.rest.issues.update({
      ...repo,
      issue_number: owned.number,
      title,
      body,
      state: "open",
    });
    return { action: "updated", issueNumber: owned.number };
  }
  const created = await github.rest.issues.create({ ...repo, title, body, labels: [LABEL] });
  return { action: "created", issueNumber: created.data.number };
}

module.exports = {
  ISSUE_MARKER,
  LABEL,
  PREVIEW_TAG_PATTERN,
  compareCommits,
  dashboardBody,
  formatPreviewNotes,
  formatStableNotes,
  latestStableUpstreamSha,
  listOpenPulls,
  listPullCommits,
  listReleases,
  loadPullsByNumber,
  previewTag,
  previewTagsToDelete,
  pullNumbersFromCommits,
  reconcileMonitorIssue,
  selectPreviewCandidates,
  stableTag,
  staleClosedPreviewTags,
};
