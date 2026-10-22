import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTuckOrder, tuckOrderForBatch } from '../src/tuckOrder';

test('later batches keep the original interleaved window order', () => {
  assert.deepEqual(tuckOrderForBatch([1, 2, 3, 4], [2, 4, 1, 3], [1, 3]), [1, 2, 3, 4]);
});
test('closed tabs disappear and new tabs use their visible neighbour', () => {
  assert.deepEqual(mergeTuckOrder([1, 2, 3, 4], [5, 2, 6, 4, 1]), [1, 5, 2, 6, 4]);
  assert.deepEqual(mergeTuckOrder([1, 2], [1, 2, 3, 4]), [1, 2, 3, 4]);
});
test('manual group reorder establishes a new baseline without undoing the user change', () => {
  assert.deepEqual(tuckOrderForBatch([1, 2, 3], [2, 3, 1], [3, 1]), [2, 3, 1]);
});
test('missing session evidence uses the restored strip rather than guessing by URL', () => {
  assert.deepEqual(tuckOrderForBatch(undefined, [20, 10, 30], [10, 30]), [20, 10, 30]);
});
