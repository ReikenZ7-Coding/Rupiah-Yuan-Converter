(function () {
  'use strict';
  const C = window.Converter;

  const REFRESH_MS = 5 * 60 * 1000;
  const CACHE_KEY = 'idr-cny:rate';
  const ORDER_KEY = 'idr-cny:order';

  const $ = (id) => document.getElementById(id);
  const inputs = { IDR: $('idr'), CNY: $('cny') };
  const fmt = { IDR: C.formatIDR, CNY: C.formatCNY };
  const other = { IDR: 'CNY', CNY: 'IDR' };

  let rate = null;        // IDR per 1 CNY
  let info = null;        // { asOf, source, fetchedAt }
  let active = 'IDR';     // the field the person last typed in
  let inflight = false;

  // localStorage can throw (private mode, blocked storage); the app works without it.
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  };

  function recalc() {
    const to = other[active];
    const out = inputs[to];
    const amount = C.parseAmount(inputs[active].value);
    if (rate == null || amount == null) { out.value = ''; return; }
    out.value = fmt[to](C.convert(amount, rate, active));
  }

  function renderRate() {
    if (rate == null) { $('rate-cny').textContent = $('rate-idr').textContent = '–'; return; }
    $('rate-cny').textContent = 'Rp ' + C.formatIDR(rate);
    $('rate-idr').textContent = '¥ ' + C.formatCNY(C.convert(10000, rate, 'IDR'));
  }

  const time = (ms) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  function setStatus(kind, text, detail) {
    $('dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
    $('status-detail').textContent = detail || '';
  }

  function describe(i) {
    const parts = [i.source];
    if (Number.isFinite(i.asOf)) parts.push('rate as of ' + time(i.asOf));
    return parts.join(' · ');
  }

  function applyRate(r, i) {
    rate = r;
    info = i;
    renderRate();
    recalc();
  }

  async function refresh() {
    if (inflight) return;
    inflight = true;
    $('refresh').disabled = true;
    if (rate == null) setStatus('loading', 'Fetching the latest rate…');

    try {
      const r = await C.fetchRate();
      const i = { asOf: r.asOf, source: r.source, fetchedAt: Date.now() };
      applyRate(r.rate, i);
      store.set(CACHE_KEY, { rate: r.rate, info: i });
      setStatus('live', 'Live · updated ' + time(i.fetchedAt), describe(i));
    } catch (err) {
      if (rate != null) {
        setStatus('stale', 'Offline · using the rate from ' + time(info.fetchedAt), describe(info));
      } else {
        setStatus('error', 'Couldn’t load the exchange rate. Check your connection and press Refresh.',
          (err.failures || [err.message]).join(' | '));
      }
    } finally {
      inflight = false;
      $('refresh').disabled = false;
    }
  }

  // --- wiring -------------------------------------------------------------

  for (const cur of ['IDR', 'CNY']) {
    inputs[cur].addEventListener('input', () => { active = cur; recalc(); });
    inputs[cur].addEventListener('blur', () => {
      // Tidy what was typed ("1000000" -> "1.000.000") once the person is done.
      const n = C.parseAmount(inputs[cur].value);
      if (n != null) inputs[cur].value = fmt[cur](n);
    });
  }

  function swapRows() {
    const rows = $('rows');
    const [first, second] = rows.querySelectorAll('.row');
    rows.insertBefore(second, first);
    rows.insertBefore($('swap'), first);   // keep the button between the two rows
    store.set(ORDER_KEY, second.dataset.currency);
  }
  $('swap').addEventListener('click', swapRows);
  $('refresh').addEventListener('click', refresh);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!info || Date.now() - info.fetchedAt > REFRESH_MS)) refresh();
  });
  window.addEventListener('online', refresh);
  setInterval(refresh, REFRESH_MS);

  // --- start --------------------------------------------------------------

  if (store.get(ORDER_KEY) === 'CNY') swapRows();
  inputs.IDR.value = C.formatIDR(1000000);
  recalc();

  const cached = store.get(CACHE_KEY);
  if (cached && C.isPlausibleRate(cached.rate) && cached.info) {
    applyRate(cached.rate, cached.info);
    setStatus('stale', 'Showing the saved rate from ' + time(cached.info.fetchedAt) + ' · refreshing…', describe(cached.info));
  }
  refresh();

  // Offline support and installability (needs HTTPS or localhost; skipped silently elsewhere).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
