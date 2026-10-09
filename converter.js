/*
 * Pure logic for the Rupiah <-> Yuan converter: amount parsing, formatting,
 * conversion and live-rate fetching. No DOM access, so it runs in the browser
 * (as window.Converter) and in Node (for tests).
 *
 * A "rate" is always IDR per 1 CNY (about 2,300 at the time of writing).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Converter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Free, key-less, CORS-enabled sources, tried in order until one answers.
  const PROVIDERS = [
    {
      name: 'open.er-api.com',
      url: 'https://open.er-api.com/v6/latest/CNY',
      parse: (d) => {
        if (d.result !== 'success') throw new Error('provider reported ' + d.result);
        return { rate: d.rates.IDR, asOf: d.time_last_update_unix * 1000 };
      },
    },
    {
      name: 'fawazahmed0/currency-api',
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',
      parse: (d) => ({ rate: d.cny.idr, asOf: Date.parse(d.date) }),
    },
    {
      name: 'fawazahmed0/currency-api (mirror)',
      url: 'https://latest.currency-api.pages.dev/v1/currencies/cny.json',
      parse: (d) => ({ rate: d.cny.idr, asOf: Date.parse(d.date) }),
    },
    {
      name: 'frankfurter.dev',
      url: 'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=IDR',
      parse: (d) => ({ rate: d.rates.IDR, asOf: Date.parse(d.date) }),
    },
  ];

  // Sanity bounds on IDR-per-CNY, to reject garbage from a misbehaving API.
  const MIN_PLAUSIBLE_RATE = 100;
  const MAX_PLAUSIBLE_RATE = 100000;
  const MAX_AMOUNT = 1e15;

  /**
   * Parse what a person typed into a number, or null if it isn't one.
   * Accepts Indonesian ("1.234.567,5"), US ("1,234,567.5") and plain ("1234.5")
   * styles, and ignores symbols and spaces ("Rp 1.000", "¥ 12.50").
   *
   *  - when both "." and "," appear, the last one is the decimal separator
   *  - a separator that appears more than once is a thousands separator
   *  - a single separator followed by exactly 3 digits is a thousands separator
   *    ("1.500" -> 1500), unless the integer part is 0 ("0.500" -> 0.5)
   *  - otherwise a single separator is a decimal point
   */
  function parseAmount(text) {
    const s = String(text == null ? '' : text).replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;

    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let decimalSep = null;

    if (lastDot !== -1 && lastComma !== -1) {
      decimalSep = lastDot > lastComma ? '.' : ',';
    } else {
      const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
      if (sep) {
        const parts = s.split(sep);
        const tail = parts[parts.length - 1];
        const thousands = parts.length > 2 || (tail.length === 3 && parts[0] !== '0' && parts[0] !== '');
        if (!thousands) decimalSep = sep;
      }
    }

    let normalized = '';
    for (const ch of s) {
      if (ch === decimalSep) normalized += '.';
      else if (ch !== '.' && ch !== ',') normalized += ch;
    }
    // A second decimal separator ("1,2,3" mixed with ".") is not a valid number.
    if ((normalized.match(/\./g) || []).length > 1) return null;

    const n = Number(normalized);
    return Number.isFinite(n) && n <= MAX_AMOUNT ? n : null;
  }

  const idrFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
  const cnyFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatIDR = (n) => idrFormat.format(n);
  const formatCNY = (n) => cnyFormat.format(n);

  /** Convert `amount` of `from` ('IDR' | 'CNY') using rate = IDR per 1 CNY. */
  function convert(amount, rate, from) {
    if (from === 'IDR') return amount / rate;
    if (from === 'CNY') return amount * rate;
    throw new Error('unknown currency: ' + from);
  }

  function isPlausibleRate(rate) {
    return typeof rate === 'number' && Number.isFinite(rate) &&
      rate >= MIN_PLAUSIBLE_RATE && rate <= MAX_PLAUSIBLE_RATE;
  }

  async function fetchJson(fetchFn, url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask each provider in turn for the IDR-per-CNY rate; the first good answer wins.
   * Resolves to { rate, asOf (ms epoch or NaN), source }. Rejects with an Error
   * whose `.failures` lists every provider's problem if none succeed.
   */
  async function fetchRate({ fetchFn, providers = PROVIDERS, timeoutMs = 8000 } = {}) {
    fetchFn = fetchFn || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchFn) throw new Error('fetch is not available');

    const failures = [];
    for (const p of providers) {
      try {
        const { rate, asOf } = p.parse(await fetchJson(fetchFn, p.url, timeoutMs));
        if (!isPlausibleRate(rate)) throw new Error('implausible rate: ' + rate);
        return { rate, asOf, source: p.name };
      } catch (err) {
        failures.push(p.name + ': ' + (err && err.name === 'AbortError' ? 'timed out' : err.message));
      }
    }
    const error = new Error('All rate providers failed');
    error.failures = failures;
    throw error;
  }

  return {
    PROVIDERS, parseAmount, formatIDR, formatCNY, convert, isPlausibleRate, fetchRate,
  };
});
