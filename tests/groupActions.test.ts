import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, entries, search } from '../src/model.ts';
import type { Snapshot } from '../src/types.ts';

const snapshot: Snapshot = { windowId: 10, currentTabId: 1, tabs: [], bookmarks: [], shortcut: '',
  groups: [{ id: 7, windowId: 10, title: 'Research', color: 'blue', collapsed: true }] };

test('group result keeps navigation primary and offers all group operations directly', () => {
  const entry = entries(snapshot).find(entry => entry.groupId === 7)!;
  assert.equal(entry.action, 'manageGroup');
  const actions = actionsFor(entry, snapshot);
  assert.deepEqual(actions.map(action => action.action), ['updateGroup', 'renameGroup', 'ungroupGroup', 'closeGroup']);
  assert.equal(actions[0].groupChanges?.collapsed, false);
  for (const [query, expected] of [['展开', 'updateGroup'], ['rename', 'renameGroup'], ['ungroup', 'ungroupGroup'], ['解散', 'ungroupGroup'], ['close', 'closeGroup'], ['关闭', 'closeGroup']]) {
    assert.ok(search(actions, query).some(action => action.action === expected), query);
  }
  assert.ok(actions.filter(action => ['closeGroup', 'ungroupGroup'].includes(action.action)).every(action => action.danger));
  assert.equal(actionsFor(entry, { ...snapshot, groups: [] }).length, 0);
});
