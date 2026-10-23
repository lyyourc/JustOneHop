import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperationFeedback } from '../src/feedbackState.ts';

test('fast completion never flashes pending; success expires after a readable interval', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const feedback = createOperationFeedback();
  const seen: unknown[] = [];
  feedback.subscribe(() => seen.push(feedback.getSnapshot()));
  const id = feedback.begin('Working');
  context.mock.timers.tick(149);
  assert.equal(feedback.getSnapshot(), null);
  feedback.success(id, 'Saved');
  context.mock.timers.tick(150);
  assert.deepEqual(seen, [{ kind: 'success', message: 'Saved' }]);
  context.mock.timers.tick(3850);
  assert.equal(feedback.getSnapshot(), null);
  feedback.dispose();
});

test('slow operations announce progress and failures persist until dismissed or retried', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const feedback = createOperationFeedback();
  const id = feedback.begin('Working');
  context.mock.timers.tick(150);
  assert.deepEqual(feedback.getSnapshot(), { kind: 'pending', message: 'Working' });
  feedback.error(id, 'Save failed; retry');
  context.mock.timers.tick(30000);
  assert.equal(feedback.getSnapshot()?.kind, 'error');
  const retry = feedback.begin('Retrying');
  feedback.success(retry, 'Saved');
  assert.equal(feedback.getSnapshot()?.message, 'Saved');
  feedback.dismiss();
  assert.equal(feedback.getSnapshot(), null);
  feedback.dispose();
});

test('old completions cannot replace a newer operation, even after dismissal', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const feedback = createOperationFeedback();
  const older = feedback.begin('First');
  const newer = feedback.begin('Second');
  feedback.success(newer, 'Second saved');
  feedback.error(older, 'First failed');
  feedback.success(older, 'First saved');
  assert.equal(feedback.getSnapshot()?.message, 'Second saved');
  feedback.dismiss();
  feedback.success(newer, 'Late result');
  context.mock.timers.tick(10000);
  assert.equal(feedback.getSnapshot(), null);
  feedback.dispose();
});

test('silent success clears pending or retry errors without clearing newer feedback', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const feedback = createOperationFeedback();
  const first = feedback.begin('Working');
  context.mock.timers.tick(150);
  feedback.success(first, null);
  assert.equal(feedback.getSnapshot(), null);
  const failed = feedback.begin('Working');
  feedback.error(failed, 'Save failed');
  const retry = feedback.begin('Retrying');
  feedback.success(retry, null);
  context.mock.timers.tick(5000);
  assert.equal(feedback.getSnapshot(), null);
  const newer = feedback.begin('New operation');
  feedback.success(newer, 'Saved');
  feedback.success(retry, null);
  assert.equal(feedback.getSnapshot()?.message, 'Saved');
  feedback.dispose();
});

test('view subscription changes retain the session result and disposal cancels timers', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const feedback = createOperationFeedback();
  let updates = 0;
  const unsubscribe = feedback.subscribe(() => updates++);
  const id = feedback.begin('Working');
  feedback.success(id, 'Copied');
  unsubscribe();
  assert.equal(feedback.getSnapshot()?.message, 'Copied');
  feedback.subscribe(() => updates++);
  feedback.dispose();
  context.mock.timers.tick(10000);
  assert.equal(updates, 1);
});
