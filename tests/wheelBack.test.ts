import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WheelBackGesture } from '../src/wheelBack';

test('one horizontal gesture including a long momentum tail returns only once', () => {
  const gesture = new WheelBackGesture();
  assert.equal(gesture.update(-20, 1).capture, true);
  gesture.update(-90, 2);
  for (let i = 20; i > 0; i--) gesture.update(-i, 0);
  assert.equal(gesture.finish(), true);
  assert.equal(gesture.finish(), false);
  gesture.update(-120, 0);
  assert.equal(gesture.finish(), true);
});

test('immediate return consumes the sequence until idle, including after layer changes', () => {
  const gesture = new WheelBackGesture();
  gesture.update(-60, 0);
  assert.equal(gesture.consume(), false);
  gesture.update(-50, 0);
  assert.equal(gesture.consume(), true);
  // A different layer or reader cannot turn the remaining momentum into input.
  gesture.block();
  for (const dx of [-60, -20, 8, -140]) {
    assert.equal(gesture.update(dx, 0, true).capture, true);
    assert.equal(gesture.consume(), false);
  }
  assert.equal(gesture.finish(), false);
  gesture.update(-120, 0);
  assert.equal(gesture.consume(), true);
});

test('short, vertical, diagonal, opposite and excluded gestures never return', () => {
  for (const events of [[[-30, 0]], [[0, 120], [-140, 0]], [[-80, 70], [-140, 0]], [[130, 0], [-140, 0]]]) {
    const gesture = new WheelBackGesture();
    for (const [x, y] of events) gesture.update(x, y);
    assert.equal(gesture.finish(), false);
  }
  const gesture = new WheelBackGesture();
  assert.equal(gesture.update(-140, 0, true).capture, false);
  assert.equal(gesture.update(-140, 0).capture, false);
  assert.equal(gesture.finish(), false);
});

test('horizontal readers own the entire sequence even after reaching their edge', () => {
  const gesture = new WheelBackGesture();
  gesture.block();
  for (const x of [-50, -200, -100]) assert.equal(gesture.update(x, 0).capture, false);
  assert.equal(gesture.finish(), false);
  gesture.update(-120, 0);
  assert.equal(gesture.finish(), true);
});

test('reversal, vertical deviation and other input cancel an armed return', () => {
  for (const cancel of [(g: WheelBackGesture) => g.update(20, 0),
    (g: WheelBackGesture) => { for (let i = 0; i < 30; i++) g.update(4, 0); },
    (g: WheelBackGesture) => g.update(0, 100), (g: WheelBackGesture) => g.block(),
    (g: WheelBackGesture) => g.update(-10, 0, true)]) {
    const gesture = new WheelBackGesture();
    gesture.update(-120, 0);
    cancel(gesture);
    gesture.update(-140, 0);
    assert.equal(gesture.finish(), false);
  }
});
