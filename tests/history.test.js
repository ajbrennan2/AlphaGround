import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistorySeries, HISTORY_WINDOWS } from '../src/history.js';
import { HistoryBuffer, HISTORY_CAPACITY } from '../src/telemetry.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('3s, 5s, and 10s windows retain the full interval at 120 Hz', () => {
    const buffer = new HistoryBuffer();
    for (let i = 0; i <= 30 * 120; i++) buffer.push(i / 120, i / 120);
    assert.equal(buffer.length, HISTORY_CAPACITY);
    for (const seconds of HISTORY_WINDOWS) {
        const points = buildHistorySeries(buffer.snapshot(), seconds);
        near(points[0].elapsed, -seconds);
        near(points.at(-1).elapsed, 0);
        assert.equal(points.length, seconds * 120 + 1);
        near(points.at(-1).average, 29.5);
        // Leftmost average includes samples before the visible chart boundary.
        near(points[0].average, 30 - seconds - 0.5);
    }
});

test('rolling average uses time rather than a fixed number of samples', () => {
    const history = [{ time: 0, value: 0 }, { time: 0.5, value: 10 }, { time: 1, value: 20 }, { time: 1.75, value: 40 }];
    assert.deepEqual(buildHistorySeries(history, 5).map(point => point.average), [0, 5, 10, 30]);
    near(buildHistorySeries(history, 10).at(-1).average, 30);
});

test('invalid samples leave raw gaps but the average continues and zero remains valid', () => {
    const points = buildHistorySeries([
        { time: 0, value: 6 }, { time: 0.2, value: null }, { time: 0.4, value: 0 },
        { time: 0.6, value: NaN }, { time: 0.8, value: Infinity }, { time: 1, value: 12 },
    ]);
    assert.deepEqual(points.map(point => point.average), [6, 6, 3, 3, 3, 6]);
    assert.equal(points[2].value, 0);
    assert.equal(points[3].value, null);
    assert.deepEqual(buildHistorySeries([]), []);
});

test('average expires when its window has no valid samples and resumes with new data', () => {
    const points = buildHistorySeries([
        { time: 0, value: null }, { time: 0.2, value: 10 },
        { time: 0.7, value: null }, { time: 1.1, value: 20 },
        { time: 1.3, value: null }, { time: 2.2, value: null },
        { time: 2.3, value: 30 },
    ]);
    assert.deepEqual(points.map(point => point.average), [null, 10, 10, 15, 20, null, 30]);
});

test('startup uses available samples without inventing earlier history', () => {
    assert.deepEqual(buildHistorySeries([{ time: 100, value: 42 }], 10), [
        { time: 100, elapsed: 0, value: 42, average: 42 },
    ]);
});

test('outages create chart gaps and old samples leave the average', () => {
    const points = buildHistorySeries([{ time: 1, value: 100 }, { time: 6, value: 20 }], 10);
    assert.equal(points.length, 3);
    assert.equal(points[1].value, null);
    assert.equal(points[1].average, null);
    assert.equal(points[2].average, 20);
});

test('a backwards server timestamp starts fresh history after a restart', () => {
    const buffer = new HistoryBuffer(5);
    buffer.push(100, 50);
    buffer.push(200, 51);
    buffer.push(10, 1);
    assert.deepEqual(buffer.snapshot(), [{ time: 1, value: 10 }]);
    assert.equal(buildHistorySeries(buffer.snapshot()).at(-1).average, 10);
});
