import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVisitTime } from '../src/visitTime';

const originalTimezone = process.env.TZ;
before(() => { process.env.TZ = 'America/New_York'; });
after(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

const now = Date.parse('2026-06-15T12:00:00-04:00');

test('missing, invalid, nonpositive, out-of-range and future visits are omitted', () => {
  for (const locale of ['en', 'zh']) {
    for (const timestamp of [undefined, null as unknown as undefined, NaN, Infinity, -Infinity, 0, -1, now + 1]) {
      assert.equal(formatVisitTime(timestamp, locale, now), undefined, `${locale}: ${timestamp}`);
    }
  }
});

test('just now ends at exactly sixty seconds, and minutes round down until one hour', () => {
  const cases = [
    { age: 0, en: 'just now', zh: '刚刚' },
    { age: 59_999, en: 'just now', zh: '刚刚' },
    { age: 60_000, en: '1 minute ago', zh: '1分钟前' },
    { age: 119_999, en: '1 minute ago', zh: '1分钟前' },
    { age: 120_000, en: '2 minutes ago', zh: '2分钟前' },
    { age: 3_599_999, en: '59 minutes ago', zh: '59分钟前' },
    { age: 3_600_000, en: 'Today 11:00', zh: '今天 11:00' },
  ];
  for (const { age, en, zh } of cases) {
    assert.equal(formatVisitTime(now - age, 'en', now)?.text, en, `English age ${age}`);
    assert.equal(formatVisitTime(now - age, 'zh', now)?.text, zh, `Chinese age ${age}`);
  }
});

test('the default reference time comes from Date.now', context => {
  context.mock.method(Date, 'now', () => now);
  assert.equal(formatVisitTime(now - 60_000, 'en')?.text, '1 minute ago');
  assert.equal(formatVisitTime(now + 1, 'zh'), undefined);
});

test('today uses local zero-padded 24-hour time, including midnight', () => {
  for (const [visit, time] of [['2026-06-15T00:00:00-04:00', '00:00'], ['2026-06-15T09:05:00-04:00', '09:05']]) {
    assert.equal(formatVisitTime(Date.parse(visit), 'en-US', now)?.text, `Today ${time}`);
    assert.equal(formatVisitTime(Date.parse(visit), 'zh-CN', now)?.text, `今天 ${time}`);
  }
  const evening = Date.parse('2026-06-15T23:00:00-04:00');
  assert.equal(formatVisitTime(evening - 3_600_000, 'en-US', evening)?.text, 'Today 22:00');
});

test('relative minutes take precedence across midnight, month and year boundaries', () => {
  for (const reference of ['2026-04-01T00:00:00-04:00', '2026-01-01T00:00:00-05:00']) {
    const midnight = Date.parse(reference);
    assert.equal(formatVisitTime(midnight - 59_999, 'en', midnight)?.text, 'just now');
    assert.equal(formatVisitTime(midnight - 60_000, 'zh', midnight)?.text, '1分钟前');
    assert.equal(formatVisitTime(midnight - 3_599_999, 'en', midnight)?.text, '59 minutes ago');
    assert.equal(formatVisitTime(midnight - 3_600_000, 'en', midnight)?.text, 'Yesterday 23:00');
    assert.equal(formatVisitTime(midnight - 3_600_000, 'zh', midnight)?.text, '昨天 23:00');
  }
});

test('yesterday follows the local calendar across month, year and leap-day boundaries', () => {
  for (const [reference, visit] of [
    ['2026-04-01T12:00:00-04:00', '2026-03-31T00:05:00-04:00'],
    ['2026-01-01T12:00:00-05:00', '2025-12-31T00:05:00-05:00'],
    ['2024-03-01T12:00:00-05:00', '2024-02-29T00:05:00-05:00'],
  ]) {
    assert.equal(formatVisitTime(Date.parse(visit), 'en', Date.parse(reference))?.text, 'Yesterday 00:05');
    assert.equal(formatVisitTime(Date.parse(visit), 'zh', Date.parse(reference))?.text, '昨天 00:05');
  }
});

test('spring DST does not mistake two calendar days ago for yesterday', () => {
  const reference = Date.parse('2026-03-09T00:15:00-04:00');
  const yesterday = Date.parse('2026-03-08T00:30:00-05:00');
  const older = Date.parse('2026-03-07T23:30:00-05:00');
  assert.equal(new Date(reference).getTimezoneOffset(), 240);
  assert.equal(new Date(yesterday).getTimezoneOffset(), 300);
  assert.equal(formatVisitTime(yesterday, 'en', reference)?.text, 'Yesterday 00:30');
  assert.equal(formatVisitTime(yesterday, 'zh', reference)?.text, '昨天 00:30');
  assert.equal(formatVisitTime(older, 'en', reference)?.text, 'Mar 7');
  assert.equal(formatVisitTime(older, 'zh', reference)?.text, '3月7日');
});

test('fall DST recognizes yesterday across a 25-hour day', () => {
  const reference = Date.parse('2026-11-01T23:30:00-05:00');
  const yesterday = Date.parse('2026-10-31T23:45:00-04:00');
  assert.equal(new Date(reference).getTimezoneOffset(), 300);
  assert.equal(new Date(yesterday).getTimezoneOffset(), 240);
  assert.equal(formatVisitTime(yesterday, 'en', reference)?.text, 'Yesterday 23:45');
  assert.equal(formatVisitTime(yesterday, 'zh', reference)?.text, '昨天 23:45');
});

test('older dates use localized month/day and include the year only for prior years', () => {
  const sameYear = Date.parse('2026-03-10T09:00:00-04:00');
  const priorYear = Date.parse('2025-12-20T09:00:00-05:00');
  assert.equal(formatVisitTime(sameYear, 'en-US', now)?.text, 'Mar 10');
  assert.equal(formatVisitTime(sameYear, 'en-GB', now)?.text, '10 Mar');
  assert.equal(formatVisitTime(sameYear, 'zh-CN', now)?.text, '3月10日');
  assert.equal(formatVisitTime(priorYear, 'en-US', now)?.text, 'Dec 20, 2025');
  assert.equal(formatVisitTime(priorYear, 'en-GB', now)?.text, '20 Dec 2025');
  assert.equal(formatVisitTime(priorYear, 'zh-CN', now)?.text, '2025年12月20日');
});

test('full contains the localized complete date and seconds while dateTime preserves the instant', () => {
  const timestamp = Date.parse('2026-01-15T12:34:56.789-05:00');
  const english = formatVisitTime(timestamp, 'en-US', now)!;
  const chinese = formatVisitTime(timestamp, 'zh-CN', now)!;
  assert.match(english.full, /January 15, 2026/);
  assert.match(english.full, /12:34:56\s*PM/);
  assert.match(chinese.full, /2026年1月15日/);
  assert.match(chinese.full, /12:34:56/);
  assert.doesNotMatch(english.full, /Last visited/i);
  assert.doesNotMatch(chinese.full, /上次访问|最后访问/);
  assert.equal(english.dateTime, '2026-01-15T17:34:56.789Z');
  assert.equal(chinese.dateTime, english.dateTime);
  assert.equal(formatVisitTime(timestamp, 'en-US', timestamp)?.full, english.full);
});
