'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Chart = require('../chart.js');

const pts = [
  { date: '2026-10-01', rate: 2600 }, { date: '2026-10-02', rate: 2700 },
  { date: '2026-10-03', rate: 2650 }, { date: '2026-10-05', rate: 2620 },
];
const box = { width: 400, height: 200 };

test('layout keeps every point inside the plot area, with higher rates drawn higher', () => {
  const g = Chart.layout(pts, box);
  for (const c of g.coords) {
    assert.ok(c.x >= g.plot.left && c.x <= g.plot.right, 'x in range');
    assert.ok(c.y >= g.plot.top && c.y <= g.plot.bottom, 'y in range');
  }
  assert.ok(g.coords[1].y < g.coords[0].y, '2700 is above 2600');
  assert.equal(g.coords[0].x, g.plot.left);
  assert.equal(g.coords.at(-1).x, g.plot.right);
});

test('layout scales x by time, not by index (weekends leave gaps)', () => {
  const g = Chart.layout(pts, box);
  const gapA = g.coords[1].x - g.coords[0].x; // 1 day
  const gapC = g.coords[3].x - g.coords[2].x; // 2 days
  assert.ok(Math.abs(gapC - 2 * gapA) < 0.5);
});

test('layout handles a perfectly flat series without NaN', () => {
  const flat = pts.map((p) => ({ ...p, rate: 2650 }));
  const g = Chart.layout(flat, box);
  assert.ok(g.coords.every((c) => Number.isFinite(c.y)));
  assert.ok(g.yTicks.every((t) => Number.isFinite(t.y) && Number.isFinite(t.value)));
});

test('layout produces a closed area path and ordered ticks', () => {
  const g = Chart.layout(pts, box);
  assert.match(g.line, /^M[\d. ]+(L[\d. ]+)+$/);
  assert.ok(g.area.endsWith('Z'));
  assert.equal(g.xTicks.length, 3);
  assert.deepEqual(g.xTicks.map((t) => t.anchor), ['start', 'middle', 'end']);
  assert.ok(g.yTicks[0].value < g.yTicks[3].value);
  assert.equal(g.min, 2600);
  assert.equal(g.max, 2700);
});

test('nearestIndex picks the closest point', () => {
  const g = Chart.layout(pts, box);
  assert.equal(Chart.nearestIndex(g.coords, 0), 0);
  assert.equal(Chart.nearestIndex(g.coords, 9999), 3);
  assert.equal(Chart.nearestIndex(g.coords, g.coords[2].x + 1), 2);
});

test('summarize reports change, percentage, high and low', () => {
  const s = Chart.summarize(pts);
  assert.equal(s.change, 20);
  assert.ok(Math.abs(s.pct - (20 / 2600) * 100) < 1e-9);
  assert.equal(s.high.date, '2026-10-02');
  assert.equal(s.low.date, '2026-10-01');
});
