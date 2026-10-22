import test from 'node:test';
import assert from 'node:assert/strict';
import { groupFingerprint, matchRecovery, readTuckRecords, recoveryCandidates, type TuckRecord, type RecoveryGroup } from '../src/tuckRecovery';
const record: TuckRecord = { key: 'saved', title: 'Tucked Away · 2', urls: ['https://a.test', 'https://b.test'], context: ['https://work.test'] };
const group: RecoveryGroup = { id: 800, windowId: 900, title: record.title, color: 'grey', context: record.context,
  tabs: record.urls.map((url, i) => ({ id: 50 + i, url, title: `Page ${i}` })) };
test('a complete unique match reconnects changed native IDs and reordered pages', () => {
  assert.equal(matchRecovery([record], [{ ...group, tabs: [...group.tabs].reverse() }]).get(record.key)?.id, 800);
});
test('same name alone, changed content, color or window context cannot auto-claim a group', () => {
  for (const change of [{ tabs: [group.tabs[0]] }, { color: 'blue' }, { context: ['https://other.test'] }, { title: 'My group' }]) {
    assert.equal(matchRecovery([record], [{ ...group, ...change }]).size, 0);
  }
  assert.equal(recoveryCandidates(record, [{ ...group, tabs: [group.tabs[0]] }]).length, 1);
  assert.equal(recoveryCandidates(record, [{ ...group, title: '', context: ['https://new-window.test'] }]).length, 1);
});
test('URL multiplicity and duplicate groups are ambiguous; no greedy assignment', () => {
  assert.equal(matchRecovery([record], [{ ...group, tabs: [group.tabs[0], { ...group.tabs[0], id: 60 }] }]).size, 0);
  assert.equal(matchRecovery([record], [group, { ...group, id: 801 }]).size, 0);
  assert.equal(matchRecovery([record, { ...record, key: 'other' }], [group]).size, 0);
});
test('same-name groups in separate windows recover independently, including staged restoration', () => {
  const first = { ...record, title: 'Tuck Away' };
  const second = { ...first, key: 'second', urls: ['https://c.test'], context: ['https://other.test'] };
  const firstGroup = { ...group, title: first.title };
  const secondGroup = { ...firstGroup, id: 801, windowId: 901, context: second.context,
    tabs: [{ id: 60, title: 'Other', url: second.urls[0] }] };
  assert.deepEqual([...matchRecovery([first, second], [firstGroup, secondGroup]).keys()], ['saved', 'second']);
  assert.deepEqual([...matchRecovery([first, second], [firstGroup]).keys()], ['saved']);
  assert.deepEqual([...matchRecovery([second], [secondGroup]).keys()], ['second']);
  // Identical member URLs still remain distinguishable by complete window context.
  assert.equal(matchRecovery([first, { ...second, urls: first.urls }],
    [firstGroup, { ...secondGroup, tabs: firstGroup.tabs }]).size, 2);
  // A confirmation-only record with the same full evidence is still ambiguous.
  assert.equal(matchRecovery([first, { ...first, key: 'legacy', requiresConfirmation: true }], [firstGroup]).size, 0);
});

test('legacy discovery always asks before management, and changed members invalidate confirmation', () => {
  assert.equal(matchRecovery([{ ...record, requiresConfirmation: true }], [group]).size, 0);
  assert.notEqual(groupFingerprint(group), groupFingerprint({ ...group, tabs: [...group.tabs, { id: 66, title: 'New', url: 'https://new.test' }] }));
  assert.notEqual(groupFingerprint(group), groupFingerprint({ ...group, windowId: 901 }));
  assert.notEqual(groupFingerprint(group), groupFingerprint({ ...group, title: 'Renamed' }));
});
test('invalid records and duplicate keys are ignored without turning names into ownership', () => {
  assert.deepEqual(readTuckRecords(null), []);
  assert.deepEqual(readTuckRecords({ version: 1, records: [null, { key: 'bad' }, record, record] }), [record]);
});

test('explicit custom title and color remain evidence across sessions', () => {
  const saved = { ...record, title: 'Later', color: 'purple', customTitle: true };
  assert.equal(matchRecovery([saved], [{ ...group, title: 'Later', color: 'purple' }]).get(saved.key)?.id, group.id);
  assert.equal(matchRecovery([saved], [{ ...group, title: 'Later', color: 'grey' }]).size, 0);
});
