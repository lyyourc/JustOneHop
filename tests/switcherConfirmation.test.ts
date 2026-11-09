import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwitcherConfirmation } from '../src/switcherConfirmation';

test('repeated confirmation is blocked until a failed switch allows retry', () => {
  const confirmation = new SwitcherConfirmation();
  assert.equal(confirmation.begin(), true);
  assert.equal(confirmation.canSelect, false);
  assert.equal(confirmation.begin(), false);
  assert.equal(confirmation.fail(), true);
  assert.equal(confirmation.canSelect, true);
  assert.equal(confirmation.begin(), true);
});

test('only an accepted switch can hand focus back; a failed handoff permits retry', () => {
  const confirmation = new SwitcherConfirmation();
  assert.equal(confirmation.returnFocus(), false);
  confirmation.begin();
  assert.equal(confirmation.returningFocus, false);
  assert.equal(confirmation.returnFocus(), true);
  assert.equal(confirmation.returningFocus, true);
  assert.equal(confirmation.begin(), false);
  assert.equal(confirmation.fail(), true);
  assert.equal(confirmation.returningFocus, false);
  assert.equal(confirmation.begin(), true);
});

test('cancellation stays terminal during selection, confirmation and focus handoff', () => {
  for (const stage of ['selecting', 'confirming', 'returning-focus']) {
    const confirmation = new SwitcherConfirmation();
    if (stage !== 'selecting') confirmation.begin();
    if (stage === 'returning-focus') confirmation.returnFocus();
    confirmation.close();
    assert.equal(confirmation.closed, true);
    assert.equal(confirmation.canSelect, false);
    assert.equal(confirmation.fail(), false);
    assert.equal(confirmation.returnFocus(), false);
    assert.equal(confirmation.begin(), false);
    confirmation.close();
    assert.equal(confirmation.closed, true);
  }
});
