'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../converter.js');

test('parseAmount: plain, Indonesian and US styles', () => {
  const cases = [
    ['1234', 1234], ['1234.5', 1234.5], ['1,5', 1.5],
    ['1.234.567', 1234567], ['1,234,567', 1234567],
    ['1.234.567,5', 1234567.5], ['1,234,567.5', 1234567.5],
    ['1.500', 1500], ['1,500', 1500], ['0.500', 0.5], ['0,250', 0.25],
    ['12.50', 12.5], ['5.', 5], ['.5', 0.5], ['Rp 1.000.000', 1000000], ['¥ 99.99', 99.99],
  ];
  for (const [input, want] of cases) assert.equal(C.parseAmount(input), want, input);
});

test('parseAmount: rejects non-numbers', () => {
  for (const input of ['', '   ', 'abc', 'Rp', null, undefined, '1.2.3,4.5', '9'.repeat(30)]) {
    assert.equal(C.parseAmount(input), null, String(input));
  }
});

test('formatting uses Indonesian grouping for IDR and 2 decimals for CNY', () => {
  assert.equal(C.formatIDR(16250000.4), '16.250.000');
  assert.equal(C.formatCNY(1234.5), '1,234.50');
  assert.equal(C.formatCNY(0), '0.00');
});

test('convert is symmetric', () => {
  const rate = 2300;
  assert.equal(C.convert(2, rate, 'CNY'), 4600);
  assert.equal(C.convert(4600, rate, 'IDR'), 2);
  assert.ok(Math.abs(C.convert(C.convert(123.45, rate, 'CNY'), rate, 'IDR') - 123.45) < 1e-9);
  assert.throws(() => C.convert(1, rate, 'USD'));
});

const ok = (body) => async () => ({ ok: true, json: async () => body });

test('fetchRate returns the first provider that answers', async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ result: 'success', time_last_update_unix: 1700000000, rates: { IDR: 2301.5 } }) };
  };
  const r = await C.fetchRate({ fetchFn });
  assert.equal(r.rate, 2301.5);
  assert.equal(r.asOf, 1700000000000);
  assert.equal(r.source, 'open.er-api.com');
  assert.equal(seen.length, 1);
});

test('fetchRate falls back past HTTP errors, bad payloads and implausible rates', async () => {
  const responses = [
    { ok: false, status: 503 },
    { ok: true, json: async () => ({ cny: { idr: 5 } }) },          // implausible
    { ok: true, json: async () => ({ unexpected: true }) },          // wrong shape
    { ok: true, json: async () => ({ date: '2025-01-02', rates: { IDR: 2250 } }) },
  ];
  let i = 0;
  const r = await C.fetchRate({ fetchFn: async () => responses[i++] });
  assert.equal(r.rate, 2250);
  assert.equal(r.source, 'frankfurter.dev');
  assert.equal(r.asOf, Date.parse('2025-01-02'));
});

test('fetchRate reports every failure when all providers fail', async () => {
  await assert.rejects(
    C.fetchRate({ fetchFn: async () => { throw new Error('network down'); } }),
    (err) => err.failures.length === C.PROVIDERS.length && /network down/.test(err.failures[0]),
  );
});

test('fetchRate times out a hung provider and moves on', async () => {
  let calls = 0;
  const fetchFn = (url, { signal }) => {
    calls++;
    if (calls === 1) {
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return ok({ cny: { idr: 2290 }, date: '2025-01-02' })();
  };
  const r = await C.fetchRate({ fetchFn, timeoutMs: 20 });
  assert.equal(r.rate, 2290);
  assert.equal(calls, 2);
});

// ---- history ---------------------------------------------------------------

test('historyRange covers the requested number of days in UTC', () => {
  const now = Date.parse('2026-10-09T23:30:00Z');
  assert.deepEqual(C.historyRange(7, now), { start: '2026-10-02', end: '2026-10-09' });
  assert.deepEqual(C.historyRange(365, now), { start: '2025-10-09', end: '2026-10-09' });
});

test('parseHistory sorts by date and drops bad points', () => {
  const pts = C.parseHistory({ rates: {
    '2026-10-03': { IDR: 2660 }, '2026-10-01': { IDR: 2650 }, '2026-10-02': { IDR: 7 }, // implausible
    'nonsense': { IDR: 2655 }, '2026-10-04': {},
  } });
  assert.deepEqual(pts, [{ date: '2026-10-01', rate: 2650 }, { date: '2026-10-03', rate: 2660 }]);
});

test('parseHistory rejects unusable bodies', () => {
  for (const body of [null, {}, { rates: [] }, { rates: { '2026-10-01': { IDR: 2650 } } }]) {
    assert.throws(() => C.parseHistory(body), undefined, JSON.stringify(body));
  }
});

test('mergeHistory lets later lists win on the same date', () => {
  const a = [{ date: '2026-01-01', rate: 2500 }, { date: '2026-01-08', rate: 2510 }];
  const b = [{ date: '2026-01-08', rate: 2520 }, { date: '2026-01-09', rate: 2530 }];
  assert.deepEqual(C.mergeHistory(a, b), [
    { date: '2026-01-01', rate: 2500 }, { date: '2026-01-08', rate: 2520 }, { date: '2026-01-09', rate: 2530 },
  ]);
});

test('cleanHistory tolerates garbage (e.g. a corrupted cache)', () => {
  assert.deepEqual(C.cleanHistory('nope'), []);
  assert.deepEqual(C.cleanHistory([null, 1, { date: '2026-01-01', rate: '2500' }]), []);
});

test('sliceDays windows relative to the newest point and never returns fewer than 2', () => {
  const pts = ['2026-09-01', '2026-09-20', '2026-10-01', '2026-10-08', '2026-10-09'].map((date) => ({ date, rate: 2600 }));
  assert.deepEqual(C.sliceDays(pts, 7).map((p) => p.date), ['2026-10-08', '2026-10-09']);
  assert.equal(C.sliceDays(pts, 365).length, 5);
  assert.equal(C.sliceDays(pts, 0).length, 5); // only 1 point in range, so fall back to everything
});

const seriesBody = (idr) => ({ ok: true, json: async () => ({ rates: { '2026-10-01': { IDR: idr }, '2026-10-02': { IDR: idr + 5 } } }) });

test('fetchHistory builds the right URL and returns points with the source', async () => {
  const urls = [];
  const r = await C.fetchHistory({ days: 30, now: Date.parse('2026-10-09T12:00:00Z'), fetchFn: async (u) => { urls.push(u); return seriesBody(2650); } });
  assert.equal(urls[0], 'https://api.frankfurter.dev/v1/2026-09-09..2026-10-09?base=CNY&symbols=IDR');
  assert.equal(r.source, 'frankfurter.dev');
  assert.equal(r.points.length, 2);
});

test('fetchHistory falls back to the second source, and reports all failures if both fail', async () => {
  let n = 0;
  const r = await C.fetchHistory({ fetchFn: async () => (n++ === 0 ? { ok: false, status: 500 } : seriesBody(2650)) });
  assert.equal(r.source, 'frankfurter.app');

  await assert.rejects(
    C.fetchHistory({ fetchFn: async () => { throw new Error('offline'); } }),
    (err) => err.failures.length === C.HISTORY_SOURCES.length,
  );
});
