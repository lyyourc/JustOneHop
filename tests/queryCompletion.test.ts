import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryCompletion } from '../src/queryCompletion';
import { addUsage, normalizeUsage, type UsageRecord } from '../src/usage';

const now = Date.now();
const safe = new Set(['command:settings']);
const record = (query: string, weight = 1, target = 'tab:https://github.com', age = 0): UsageRecord => ({ query, weight, target, lastUsed: now - age * 86400000 });

test('completion matches a strict prefix, preserves typed case and supports Chinese', () => {
  const history = [record('github'), record('标签设置', 1, 'command:settings')];
  assert.equal(queryCompletion(history, 'G', safe, now), 'Github');
  assert.equal(queryCompletion(history, '标签', safe, now), '标签设置');
  for (const prefix of ['', ' ', ' g', 'github', 'hub', 'githuub']) assert.equal(queryCompletion(history, prefix, safe, now), '');
});

test('completion preserves saved path case while ranking retains its normalized query', () => {
  const history = addUsage([], 'github.com/Team/Repo', 'query:navigation', now);
  assert.equal(history[0].query, 'github.com/team/repo');
  assert.equal(queryCompletion(normalizeUsage(history, now), 'github.com/T', safe, now), 'github.com/Team/Repo');
  assert.equal(queryCompletion([{ ...record('github'), queryText: 'unrelated' }], 'g', safe, now), 'github');
});

test('completion aggregates frequency across targets and decays older queries', () => {
  const history = [record('github', 2), record('github', 2, 'bookmark:1'), record('gmail', 3), record('google', 10, 'tab:https://google.com', 56)];
  assert.equal(queryCompletion(history, 'g', safe, now), 'github');
  assert.equal(queryCompletion([record('github', 1, undefined, 91)], 'g', safe, now), '');
  assert.equal(queryCompletion([record('github', 1, undefined, 2), record('gmail')], 'g', safe, now), 'gmail');
});

test('completion excludes destructive and unavailable commands, but accepts successful web searches', () => {
  const history = [record('close right', 10, 'command:closeRight'), record('settings', 1, 'command:settings'), record('google react hooks', 1, 'query:navigation')];
  assert.equal(queryCompletion(history, 'c', safe, now), '');
  assert.equal(queryCompletion(history, 's', safe, now), 'settings');
  assert.equal(queryCompletion(history, 's', new Set(), now), '');
  assert.equal(queryCompletion(history, 'google r', safe, now), 'google react hooks');
});
