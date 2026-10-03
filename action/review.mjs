#!/usr/bin/env node
/**
 * Entry point for the `githeat review` GitHub Action.
 *
 * Two jobs, deliberately separated so the interesting half is testable:
 *   1. work out which files changed (git, or an explicit list)  -> here
 *   2. turn that into a comment                                 -> src/review.mjs
 *
 * The comment is POSTed with plain fetch, so the action needs no dependencies
 * and nothing from the marketplace beyond actions/checkout.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

import { readHistory, repoRoot, headSha } from '../src/git.mjs';
import { analyze, DEFAULT_MIN_COMMITS } from '../src/analyze.mjs';
import { readChangedList, reviewReport, renderReviewMarkdown } from '../src/review.mjs';

/**
 * Action inputs, read explicitly.
 *
 * The names are spelled out as literal `process.env.INPUT_*` reads on purpose:
 * a computed lookup (`INPUT_${name}`) hides from static checks, and there is a
 * test that every input declared in action.yml is actually read here. Getting
 * that wrong means the action silently ignores a documented option.
 */
const inputs = {
  path: process.env.INPUT_PATH ?? '.',
  base: process.env.INPUT_BASE ?? '',
  head: process.env.INPUT_HEAD ?? 'HEAD',
  changedFiles: process.env.INPUT_CHANGED_FILES ?? '',
  since: process.env.INPUT_SINCE ?? '',
  minCommits: process.env.INPUT_MIN_COMMITS ?? '2',
  limit: process.env.INPUT_LIMIT ?? '10',
  comment: process.env.INPUT_COMMENT ?? 'true',
  pullRequest: process.env.INPUT_PULL_REQUEST ?? '',
  token: process.env.INPUT_TOKEN ?? '',
};

const input = (value, fallback = '') => String(value ?? fallback).trim();

const fail = (message) => {
  process.stderr.write(`githeat-review: ${message}\n`);
  process.exit(1);
};

const cwd = input(inputs.path, '.') || '.';
if (!repoRoot(cwd)) fail(`${cwd} is not inside a git work tree`);

// ---------- 1. which files changed -----------------------------------------
let changed = [];
const changedFile = input(inputs.changedFiles);
if (changedFile) {
  changed = readChangedList(changedFile);
} else {
  const base = input(inputs.base);
  const head = input(inputs.head) || 'HEAD';
  const spec = base ? `${base}...${head}` : `${head}~1..${head}`;
  const res = spawnSync('git', ['-C', cwd, 'diff', '--name-only', spec, '--'], { encoding: 'utf8' });
  if (res.status !== 0) fail(`git diff ${spec} failed: ${(res.stderr || '').trim()}`);
  changed = readChangedList(null, res.stdout ?? '');
}

// git diff always reports repo-relative paths, which is what analyze() produces
const root = repoRoot(cwd);
const repository = (process.env.GITHUB_REPOSITORY ?? root).split('/').pop();

// ---------- 2. score them against the repository's own history -------------
const since = input(inputs.since);
const limit = Number(input(inputs.limit, '10')) || 10;
const commits = readHistory({ cwd: root, since: since || undefined });
const report = analyze(commits, {
  minCommits: Number(input(inputs.minCommits, String(DEFAULT_MIN_COMMITS))) || DEFAULT_MIN_COMMITS,
  bands: 'absolute', // a PR comment should use the same yardstick on every repository
});

const result = reviewReport(report, changed, { limit });
const markdown = renderReviewMarkdown(result, {
  repository,
  rev: headSha(root) ?? 'HEAD',
  range: since || 'all time',
  limit,
});

// ---------- 3. deliver ------------------------------------------------------
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
}

const token = input(inputs.token);
const eventPath = process.env.GITHUB_EVENT_PATH;
let prNumber = Number(input(inputs.pullRequest)) || 0;
if (!prNumber && eventPath) {
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    prNumber = event.pull_request?.number ?? event.issue?.number ?? 0;
  } catch {
    /* not a PR event; the step summary is still useful */
  }
}

const marker = '<!-- githeat-review -->';
const body = `${marker}\n${markdown}`;

if (input(inputs.comment, 'true') === 'false' || !token || !prNumber) {
  process.stdout.write(
    `githeat-review: summary written${token && prNumber ? '' : ' (no comment posted: needs a pull_request event and a token)'}\n`,
  );
  process.exit(0);
}

const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
if (!owner || !repo) fail('GITHUB_REPOSITORY is not set');

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'content-type': 'application/json',
  'user-agent': 'githeat-review',
};

const listRes = await fetch(`${api}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, { headers });
const existing = listRes.ok ? (await listRes.json()).find((c) => typeof c.body === 'string' && c.body.startsWith(marker)) : null;

// one comment per PR, edited in place: pushing 20 commits must not spam 20 comments
const writeRes = existing
  ? await fetch(`${api}/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body }),
    })
  : await fetch(`${api}/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
    });

if (!writeRes.ok) {
  fail(`could not ${existing ? 'update' : 'post'} the comment: HTTP ${writeRes.status} ${await writeRes.text()}`);
}
process.stdout.write(`githeat-review: ${existing ? 'updated' : 'posted'} the comment on #${prNumber}\n`);
