/**
 * The GitHub Action is the part of this project that runs inside somebody
 * else's repository, where a silent failure is expensive: GitHub simply does
 * not run an action whose manifest is wrong. These checks are cheap and catch
 * the two realistic mistakes — a manifest that points at a missing entry file,
 * and an input that nobody reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const actionDir = join(root, 'action');
const manifest = readFileSync(join(actionDir, 'action.yml'), 'utf8');
const entry = readFileSync(join(actionDir, 'review.mjs'), 'utf8');

/**
 * Input names are the keys directly under `inputs:` — two spaces of indent, a
 * bare `name:` and nothing else. Everything nested below (description,
 * required, default) sits deeper and must not be picked up.
 */
const inputNames = () =>
  [...manifest.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);

test('action.yml declares what GitHub requires', () => {
  for (const field of ['name:', 'description:', 'runs:', 'using:', 'main:']) {
    assert.ok(manifest.includes(field), `action.yml is missing ${field}`);
  }
  assert.match(manifest, /using:\s*node(18|20|22)/, 'the action must declare a supported Node runtime');
  const main = manifest.match(/main:\s*(\S+)/)[1];
  assert.ok(existsSync(join(actionDir, main)), `runs.main points at a missing file: ${main}`);
});

test('every declared input is actually read by the entry point', () => {
  const declared = inputNames();
  assert.ok(declared.length >= 5, `expected several inputs, parsed ${declared.length}: ${declared.join(', ')}`);
  assert.ok(declared.includes('token'), 'the token input should be declared');
  // the entry point spells the env var names out literally, so this is a real check
  const unread = declared.filter((name) => !entry.includes(`INPUT_${name.toUpperCase().replace(/-/g, '_')}`));
  assert.deepEqual(unread, [], `declared but never read: ${unread.join(', ')}`);
});

test('every declared input has a fallback so a minimal workflow works', () => {
  const block = entry.match(/const inputs = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'expected an explicit inputs object in the entry point');
  const entries = [...block[1].matchAll(/^\s{2}(\w+):\s*process\.env\.INPUT_[A-Z_]+\s*\?\?\s*(.+?),?$/gm)];
  assert.ok(entries.length >= 5, `expected fallbacks for each input, found ${entries.length}`);
  const empty = entries.filter(([, , fallback]) => !fallback.trim()).map(([, name]) => name);
  assert.deepEqual(empty, [], `inputs without a fallback: ${empty.join(', ')}`);
});

test('the action does not depend on the package being installed', () => {
  // It ships as a plain Node script: no node_modules, no build step, no imports
  // from outside the repository.
  assert.ok(!existsSync(join(actionDir, 'package.json')), 'the action should not need its own package.json');
  const imports = [...entry.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(spec.startsWith('node:') || spec.startsWith('.'), `unexpected dependency: ${spec}`);
  }
});

test('the self-test workflow runs this repository own action', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'review.yml'), 'utf8');
  assert.match(workflow, /uses:\s*\.\/action/, 'the workflow should exercise ./action');
  assert.match(workflow, /pull-requests:\s*write/, 'commenting needs pull-requests: write');
  assert.match(workflow, /fetch-depth:\s*0/, 'the review needs real history to rank against');
});
