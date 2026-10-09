/*
 * Geometry for the history line chart. Pure maths, no DOM, so it can be unit-tested.
 * The browser code (history.js) turns the result into SVG.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_MARGIN = { top: 12, right: 12, bottom: 24, left: 56 };

  /** Lay `points` ({ date, rate }, sorted, at least 2) out in a width x height box. */
  function layout(points, { width, height, margin = DEFAULT_MARGIN }) {
    const times = points.map((p) => Date.parse(p.date));
    const rates = points.map((p) => p.rate);
    const t0 = times[0];
    const t1 = times[times.length - 1];
    const min = Math.min(...rates);
    const max = Math.max(...rates);

    // Pad the value axis so the line never touches the edges, even when the rate is flat.
    const pad = (max - min) * 0.12 || max * 0.005;
    const lo = min - pad;
    const hi = max + pad;

    const plot = { left: margin.left, right: width - margin.right, top: margin.top, bottom: height - margin.bottom };
    const x = (t) => plot.left + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (plot.right - plot.left);
    const y = (v) => plot.top + (1 - (v - lo) / (hi - lo)) * (plot.bottom - plot.top);

    const coords = points.map((p, i) => ({ x: x(times[i]), y: y(rates[i]), date: p.date, rate: p.rate }));
    const pt = (c) => c.x.toFixed(1) + ' ' + c.y.toFixed(1);
    const line = coords.map((c, i) => (i ? 'L' : 'M') + pt(c)).join(' ');
    const area = line + ' L' + coords[coords.length - 1].x.toFixed(1) + ' ' + plot.bottom +
      ' L' + coords[0].x.toFixed(1) + ' ' + plot.bottom + ' Z';

    const yTicks = [0, 1, 2, 3].map((i) => {
      const value = lo + ((hi - lo) * i) / 3;
      return { y: y(value), value };
    });
    const xTicks = [0, 0.5, 1].map((f) => {
      const time = t0 + (t1 - t0) * f;
      return { x: x(time), time, anchor: f === 0 ? 'start' : f === 1 ? 'end' : 'middle' };
    });

    return { coords, line, area, yTicks, xTicks, plot, min, max };
  }

  /** Index of the coordinate whose x is closest to `px`. */
  function nearestIndex(coords, px) {
    let best = 0;
    for (let i = 1; i < coords.length; i++) {
      if (Math.abs(coords[i].x - px) < Math.abs(coords[best].x - px)) best = i;
    }
    return best;
  }

  /** First/last value, change, and the high and low points of a series. */
  function summarize(points) {
    const first = points[0];
    const last = points[points.length - 1];
    let high = first;
    let low = first;
    for (const p of points) {
      if (p.rate > high.rate) high = p;
      if (p.rate < low.rate) low = p;
    }
    const change = last.rate - first.rate;
    return { first, last, change, pct: (change / first.rate) * 100, high, low };
  }

  return { layout, nearestIndex, summarize };
});
