/**
 * Shared test fixtures. Kept in one place so every test builds repos the
 * same way (and so we never touch the developer's global git config).
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'githeat.mjs');

/**
 * Run a git command inside `cwd` and fail loudly.
 *
 * `date` sets both author and committer dates. `git commit --date` only sets the
 * author date, and `git blame` reports the committer date, so line-age fixtures
 * are silently wrong without this.
 */
export function gitIn(cwd, args, { date } = {}) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      GIT_CONFIG_GLOBAL: join(tmpdir(), 'githeat-no-such-global-config'),
      GIT_CONFIG_SYSTEM: join(tmpdir(), 'githeat-no-such-system-config'),
    },
  });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout ?? '';
}

/** Run the CLI in-process-free fashion and capture stdout/exit code. */
export function runCli(args, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', ...(opts.env ?? {}) },
    cwd: opts.cwd,
  });
  return { code: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * Create a throwaway repository whose history is deliberately shaped:
 *   src/core.js   hot   (every commit)
 *   src/util.js   warm  (every other commit)
 *   src/rare.js   cold  (3 commits)
 *   README.md     cold  (1 commit -> filtered out by the default threshold)
 *   package-lock.json noise (ignored unless --include-noise)
 */
export function makeRepo(prefix = 'githeat-fixture-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  gitIn(dir, ['init', '-q', '-b', 'main']);
  gitIn(dir, ['config', 'commit.gpgsign', 'false']);

  const files = {
    'src/core.js': 'export const core = () => 1;\n',
    'src/util.js': 'export const util = () => 2;\n',
    'src/rare.js': 'export const rare = () => 3;\n',
    'README.md': '# fixture\n',
    'package-lock.json': '{"lockfileVersion": 3}\n',
  };
  for (let i = 0; i < 12; i += 1) {
    const touched = ['src/core.js'];
    if (i % 2 === 0) touched.push('src/util.js');
    if (i === 2 || i === 6 || i === 10) touched.push('src/rare.js');
    if (i === 0) touched.push('README.md');
    touched.push('package-lock.json');
    for (const path of touched) {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), `${files[path]}// rev ${i}\n`);
    }
    gitIn(dir, ['add', '-A']);
    gitIn(dir, ['commit', '-q', '-m', `rev ${i}`, '--date', `2024-03-${String(i + 1).padStart(2, '0')}T12:00:00Z`]);
  }
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }),
  };
}
