import test from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, nearestPoint } from '../src/chartGeometry.js';
import { buildHistorySeries } from '../src/history.js';

test('rolling average draws one continuous path across intermittent missing readings', () => {
    const data = buildHistorySeries([
        { time: 0, value: 6 }, { time: 0.2, value: null },
        { time: 0.4, value: 0 }, { time: 0.6, value: NaN },
        { time: 0.8, value: 12 },
    ]);
    const plot = chartGeometry(data, 700, 5);
    assert.equal((plot.current.match(/M/g) || []).length, 3);
    assert.equal((plot.average.match(/M/g) || []).length, 1);
    assert.equal((plot.average.match(/L/g) || []).length, 4);
});

test('plot paths keep gaps and short spikes without allocating a node per sample', () => {
    const data = [
        { elapsed: -3, value: 0, average: 0 },
        { elapsed: -2.9, value: 1000, average: 500 },
        { elapsed: -2.8, value: 0, average: 333 },
        { elapsed: -2, value: null, average: null },
        { elapsed: 0, value: 5, average: 5 },
    ];
    const plot = chartGeometry(data, 700, 3);
    assert.ok(plot.max > 1000);
    assert.equal((plot.current.match(/M/g) || []).length, 2);
    assert.equal((plot.average.match(/M/g) || []).length, 2);
    assert.equal((plot.current.match(/[ML]/g) || []).length, 5);
    assert.ok(!plot.current.includes('NaN'));
});

test('empty and constant histories use finite chart ranges', () => {
    for (const data of [[], [{ elapsed: 0, value: 0, average: 0 }]]) {
        const plot = chartGeometry(data, 240, 5);
        assert.ok(Number.isFinite(plot.min) && Number.isFinite(plot.max));
        assert.ok(plot.max > plot.min);
        assert.ok(!plot.current.includes('NaN'));
    }
});

test('hover lookup finds nearest samples and does not fill gaps', () => {
    const data = [{ elapsed: -5, value: 1 }, { elapsed: -2, value: null }, { elapsed: 0, value: 2 }];
    assert.equal(nearestPoint([], 0), null);
    assert.equal(nearestPoint(data, -4.5), data[0]);
    assert.equal(nearestPoint(data, -2.1), data[1]);
    assert.equal(nearestPoint(data, 0), data[2]);
});

test('isolated valid points remain visible without drawing across missing data', () => {
    const plot = chartGeometry([
        { elapsed: -2, value: 10, average: null },
        { elapsed: -1, value: null, average: null },
        { elapsed: 0, value: 20, average: null },
    ], 700, 5, 140);
    assert.equal((plot.current.match(/M/g) || []).length, 2);
    assert.equal((plot.current.match(/L/g) || []).length, 2);
    assert.ok(plot.y(10) < 140 && plot.y(20) > 0);
});

test('tiny fluctuations do not fill the whole vertical range', () => {
    const plot = chartGeometry([{ elapsed: -1, value: 100 }, { elapsed: 0, value: 100.001 }], 700, 5);
    assert.ok(plot.max - plot.min > 10);
});
