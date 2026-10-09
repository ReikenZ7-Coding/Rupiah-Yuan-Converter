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
