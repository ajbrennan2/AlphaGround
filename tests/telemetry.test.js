import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryStore, HistoryBuffer, HISTORY_CAPACITY, HISTORY_INTERVAL_MS } from '../src/telemetry.js';

function frame(overrides = {}) {
    return { temps: [0, 1, 2, 3], pressures: Array(12).fill(100), thrusts: [4],
        acc: [0, -20, 30], solenoids: [0, 0, 0, 0], keys: [1], burn: [1],
        state: 0, going: 0, time: 10, ...overrides };
}

test('ring retains the newest samples in chronological order after wrapping', () => {
    const ring = new HistoryBuffer(3);
    for (let i = 0; i < 10; i++) ring.push(i, i / 100);
    assert.deepEqual(ring.snapshot(), [7, 8, 9].map(value => ({ value, time: value / 100 })));
    assert.equal(ring.values.length, 3);
});

test('snapshots remain immutable after subsequent writes', () => {
    const ring = new HistoryBuffer(1);
    ring.push(0, 1);
    const previous = ring.snapshot();
    ring.push(2, 3);
    assert.deepEqual(previous, [{ value: 0, time: 1 }]);
});

test('acquisition does not notify React until publication', () => {
    const store = createTelemetryStore();
    let calls = 0;
    store.subscribe('temps', () => calls++);
    for (let i = 0; i < 5; i++) store.ingest(frame({ temps: [i, 1, 2, 3] }));
    assert.equal(calls, 0);
    assert.equal(store.getSnapshot('temps')[0], null);
    store.publish();
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot('temps')[0], 4);
    assert.equal(store.getHistory('temps.0').length, 5);
});

test('unchanged groups retain identity and do not notify controls', () => {
    const store = createTelemetryStore();
    store.ingest(frame()); store.publish();
    const temps = store.getSnapshot('temps');
    let calls = 0;
    store.subscribe('temps', () => calls++);
    store.subscribe('solenoids', () => calls++);
    store.ingest(frame({ acc: [1, 2, 3], time: 11 })); store.publish();
    assert.equal(calls, 0);
    assert.equal(store.getSnapshot('temps'), temps);
});

test('history stays bounded without any publication (hidden window)', () => {
    const store = createTelemetryStore();
    for (let i = 0; i < 10000; i++) store.ingest(frame({ time: i / 100, thrusts: [i] }));
    const points = store.getHistory('thrusts.0');
    assert.equal(points.length, HISTORY_CAPACITY);
    assert.equal(points[0].value, 10000 - HISTORY_CAPACITY);
    assert.equal(points.at(-1).value, 9999);
});

test('hidden charts allocate no point snapshots; only mounted charts are published', () => {
    const original = HistoryBuffer.prototype.snapshot;
    let allocations = 0;
    HistoryBuffer.prototype.snapshot = function () { allocations++; return original.call(this); };
    try {
        const store = createTelemetryStore();
        store.ingest(frame()); store.publish(0);
        assert.equal(allocations, 0);
        let updates = 0;
        const unsubscribe = store.subscribe('temps.0', () => updates++);
        store.publish(0);
        assert.equal(allocations, 1);
        assert.equal(updates, 1);
        const previous = store.getHistory('temps.0');
        assert.equal(store.getHistory('temps.0'), previous);
        store.publish();
        assert.equal(updates, 1);
        // Constant samples still advance the chart's time window.
        store.ingest(frame({ time: 11 })); store.publish(HISTORY_INTERVAL_MS);
        assert.equal(updates, 2);
        unsubscribe();
        store.ingest(frame()); store.publish();
        assert.equal(allocations, 2);
    } finally { HistoryBuffer.prototype.snapshot = original; }
});

test('null and invalid readings remain gaps while valid zero is retained', () => {
    const store = createTelemetryStore();
    store.ingest(frame({ temps: [null, NaN, Infinity, 0], pressures: [-1, 5001, NaN, ...Array(9).fill(0)] }));
    store.publish();
    assert.deepEqual(store.getSnapshot('temps'), [null, null, null, 0]);
    assert.deepEqual(store.getSnapshot('pressures').slice(0, 4), [-1, 5001, null, 0]);
    assert.equal(store.getHistory('temps.0')[0].value, null);
    assert.equal(store.getHistory('temps.3')[0].value, 0);
});

test('malformed frames do not partially overwrite live data or append history', () => {
    const store = createTelemetryStore();
    store.ingest(frame()); store.publish();
    const previous = store.getLatest();
    for (const bad of [null, [], 'x', {}, frame({ acc: [1] }), frame({ pressures: null })]) {
        assert.equal(store.ingest(bad), false);
    }
    assert.equal(store.getLatest(), previous);
    assert.equal(store.getHistory('temps.0').length, 1);
});

test('timestamps use server time or the supplied receive time for legacy mocks', () => {
    const store = createTelemetryStore();
    store.ingest(frame({ time: undefined }), 20);
    store.ingest(frame({ time: 21 }), 99);
    assert.deepEqual(store.getHistory('temps.0').map(point => point.time), [20, 21]);
});

test('state and continuity remain unknown for invalid values; serial loss is published', () => {
    const store = createTelemetryStore();
    store.ingest(frame({ keys: ['1'], burn: [2], state: 100, serial_connected: false }));
    store.publish();
    assert.deepEqual(store.getSnapshot('keys'), [null]);
    assert.deepEqual(store.getSnapshot('burn'), [null]);
    assert.equal(store.getSnapshot('state'), null);
    assert.equal(store.getSnapshot('serial_connected'), false);
});

test('active history stays at 10 Hz while live readings publish every display tick', () => {
    const store = createTelemetryStore();
    let updates = 0;
    const unsubscribe = store.subscribe('temps.0', () => updates++);
    store.ingest(frame({ time: 0 })); store.publish(0);
    const first = store.getHistory('temps.0');
    for (let ms = 10; ms < 100; ms += 10) {
        store.ingest(frame({ time: ms / 1000, temps: [ms, 1, 2, 3] }));
        store.publish(ms);
        assert.equal(store.getSnapshot('temps')[0], ms);
        assert.equal(store.getHistory('temps.0'), first, 'React snapshot reads must not bypass throttling');
    }
    assert.equal(updates, 1);
    store.publish(100);
    assert.equal(updates, 2);
    assert.equal(store.getHistory('temps.0').at(-1).value, 90);
    unsubscribe();
});

test('closing a history frees its materialized snapshot and reopening catches up', () => {
    const store = createTelemetryStore();
    const unsubscribe = store.subscribe('temps.0', () => {});
    store.ingest(frame({ time: 1 })); store.publish(0);
    const snapshot = store.getHistory('temps.0');
    unsubscribe();
    assert.notEqual(store.getHistory('temps.0'), snapshot, 'The prior materialized array should be released');
    store.ingest(frame({ time: 2, temps: [42, 1, 2, 3] }));
    const resubscribe = store.subscribe('temps.0', () => {});
    store.publish(1);
    assert.equal(store.getHistory('temps.0').at(-1).value, 42);
    resubscribe();
});

test('serial loss creates gaps instead of charting retained values as live measurements', () => {
    const store = createTelemetryStore();
    store.ingest(frame({ time: 1, serial_connected: true }));
    store.ingest(frame({ time: 2, serial_connected: false }));
    store.ingest(frame({ time: 3, serial_connected: true }));
    assert.deepEqual(store.getHistory('temps.0').map(point => point.value), [0, null, 0]);
});

test('a manually changed endpoint clears old readings and subscribed histories', () => {
    const store = createTelemetryStore();
    store.ingest(frame()); store.publish();
    store.subscribe('temps.0', () => {});
    const previous = store.getHistory('temps.0');
    store.reset();
    assert.deepEqual(store.getSnapshot('temps'), [null, null, null, null]);
    assert.deepEqual(store.getHistory('temps.0'), []);
    assert.equal(previous.length, 1);
    store.ingest(frame({ time: 1 })); store.publish();
    assert.equal(store.getHistory('temps.0').length, 1);
});
