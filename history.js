(function () {
  'use strict';
  const C = window.Converter;
  const Chart = window.Chart;

  const CACHE_KEY = 'idr-cny:history';
  const RANGE_KEY = 'idr-cny:range';
  const FRESH_MS = 6 * 60 * 60 * 1000;   // the source publishes once a day
  const HEIGHT = 200;
  const RANGES = { 7: '7 days', 30: '30 days', 90: '90 days', 365: 'year' };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (id) => document.getElementById(id);
  const chartEl = $('chart');
  if (!chartEl) return;

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  };

  const rateFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
  const dateLabel = (ms, withYear) =>
    new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });

  let all = null;       // every known point, oldest first
  let source = '';
  let days = Number(store.get(RANGE_KEY));
  if (!RANGES[days]) days = 90;
  let inflight = false;

  function svgEl(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function message(text) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = text;
    chartEl.replaceChildren(div);
    $('hist-summary').textContent = '';
  }

  function render() {
    if (!all) return;
    const points = C.sliceDays(all, days);
    const width = Math.max(chartEl.clientWidth, 240);
    const g = Chart.layout(points, { width, height: HEIGHT });
    const s = Chart.summarize(points);
    const longSpan = Date.parse(s.last.date) - Date.parse(s.first.date) > 200 * 86400000;

    // Summary line (text, so it works for screen readers and doesn't rely on colour).
    const sign = s.change > 0 ? '+' : s.change < 0 ? '−' : '';
    $('hist-summary').replaceChildren(
      document.createTextNode('Last ' + RANGES[days] + ': '),
      Object.assign(document.createElement('strong'), {
        textContent: sign + Math.abs(s.pct).toFixed(2) + '%',
      }),
      document.createTextNode(' · high Rp ' + rateFmt.format(s.high.rate) + ' · low Rp ' + rateFmt.format(s.low.rate)),
    );

    const svg = svgEl('svg', {
      viewBox: '0 0 ' + width + ' ' + HEIGHT, role: 'img',
      'aria-label': 'Line chart of rupiah per yuan over the last ' + RANGES[days] + ', from Rp ' +
        rateFmt.format(s.first.rate) + ' to Rp ' + rateFmt.format(s.last.rate),
    });
    for (const t of g.yTicks) {
      svg.append(svgEl('line', { class: 'grid', x1: g.plot.left, x2: g.plot.right, y1: t.y, y2: t.y }));
      const label = svgEl('text', { class: 'tick', x: g.plot.left - 6, y: t.y + 3, 'text-anchor': 'end' });
      label.textContent = C.formatIDR(t.value);
      svg.append(label);
    }
    for (const t of g.xTicks) {
      const label = svgEl('text', { class: 'tick', x: t.x, y: HEIGHT - 6, 'text-anchor': t.anchor });
      label.textContent = dateLabel(t.time, longSpan);
      svg.append(label);
    }
    svg.append(svgEl('path', { class: 'area', d: g.area }), svgEl('path', { class: 'line', d: g.line }));

    const cursor = svgEl('line', { class: 'cursor', y1: g.plot.top, y2: g.plot.bottom, visibility: 'hidden' });
    const marker = svgEl('circle', { class: 'dot-marker', r: 4, visibility: 'hidden' });
    svg.append(cursor, marker);

    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.hidden = true;

    function show(clientX) {
      const box = svg.getBoundingClientRect();
      const c = g.coords[Chart.nearestIndex(g.coords, ((clientX - box.left) / box.width) * width)];
      cursor.setAttribute('x1', c.x); cursor.setAttribute('x2', c.x);
      marker.setAttribute('cx', c.x); marker.setAttribute('cy', c.y);
      cursor.setAttribute('visibility', 'visible'); marker.setAttribute('visibility', 'visible');
      tip.replaceChildren(
        document.createTextNode('Rp ' + rateFmt.format(c.rate)),
        Object.assign(document.createElement('small'), { textContent: dateLabel(Date.parse(c.date), true) }),
      );
      tip.hidden = false;
      const left = (c.x / width) * box.width - tip.offsetWidth / 2;
      tip.style.left = Math.min(Math.max(left, 0), box.width - tip.offsetWidth) + 'px';
    }
    function hide() {
      cursor.setAttribute('visibility', 'hidden'); marker.setAttribute('visibility', 'hidden'); tip.hidden = true;
    }
    svg.addEventListener('pointermove', (e) => show(e.clientX));
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointerleave', hide);

    chartEl.dataset.points = String(points.length);
    chartEl.replaceChildren(svg, tip);
  }

  function setNote(text) { $('hist-note').textContent = text; }

  function sourceNote() {
    return 'Daily reference rates (European Central Bank, via ' + source + '). They can differ slightly from the live rate above.';
  }

  async function load() {
    if (inflight) return;
    const cached = store.get(CACHE_KEY);
    const saved = cached ? C.cleanHistory(cached.points) : [];
    if (saved.length >= 2) {
      all = saved;
      source = cached.source || 'cache';
      render();
      setNote(sourceNote());
      if (Date.now() - cached.fetchedAt < FRESH_MS) return;
    }

    inflight = true;
    try {
      // One request for the year and one for the last 90 days: some sources thin out
      // older data, and the recent window should always be daily.
      const results = await Promise.allSettled([C.fetchHistory({ days: 365 }), C.fetchHistory({ days: 90 })]);
      const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
      if (!ok.length) {
        const err = new Error('history unavailable');
        err.failures = results.flatMap((r) => (r.reason && r.reason.failures) || []);
        throw err;
      }
      all = C.mergeHistory(...ok.map((r) => r.points));
      source = ok[ok.length - 1].source;
      store.set(CACHE_KEY, { points: all, source, fetchedAt: Date.now() });
      render();
      setNote(sourceNote());
    } catch (err) {
      if (all) setNote('Couldn’t refresh the history; showing saved data.');
      else { message('Couldn’t load the rate history. It will retry when you’re back online.'); setNote((err.failures || []).join(' | ')); }
    } finally {
      inflight = false;
    }
  }

  // --- wiring ---------------------------------------------------------------

  const buttons = document.querySelectorAll('.ranges button');
  function syncButtons() {
    for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
  }
  for (const b of buttons) {
    b.addEventListener('click', () => {
      days = Number(b.dataset.days);
      store.set(RANGE_KEY, days);
      syncButtons();
      render();
    });
  }
  syncButtons();

  if (typeof ResizeObserver === 'function') {
    let frame = 0;
    new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(render); }).observe(chartEl);
  }
  window.addEventListener('online', () => { if (!all) load(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  load();
})();
