import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionUrl } from '../src/connectionSettings.js';
import { resolveValveRequests, waitingValveRequests } from '../src/console/valveRequests.js';

test('IP entry supplies bridge defaults and full URLs retain explicit routing', () => {
    assert.equal(connectionUrl({ endpoint: ' 192.168.0.20 ' }), 'ws://192.168.0.20:3333/data');
    assert.equal(connectionUrl({ endpoint: 'localhost:9000/custom' }), 'ws://localhost:9000/custom');
    assert.equal(connectionUrl({ endpoint: 'wss://example.org/data' }), 'wss://example.org/data');
    assert.equal(connectionUrl({ endpoint: 'ws://[::1]:3333/data' }), 'ws://[::1]:3333/data');
});

test('serial paths are encoded, required, and removed when switching to network', () => {
    const url = connectionUrl({ endpoint: 'localhost', mode: 'serial', serialPort: '/dev/tty USB&1' });
    assert.equal(new URL(url).searchParams.get('serial_port'), '/dev/tty USB&1');
    assert.equal(connectionUrl({ endpoint: url, mode: 'network' }), 'ws://localhost:3333/data');
    assert.throws(() => connectionUrl({ endpoint: 'localhost', mode: 'serial' }), /serial port/);
});

test('invalid endpoints are rejected before opening a connection', () => {
    for (const endpoint of ['', 'not an address', 'http://localhost', 'ws://user:secret@localhost', 'ws://localhost/#secret']) {
        assert.throws(() => connectionUrl({ endpoint }));
    }
});

test('only a later matching board report resolves a sent valve request', () => {
    const requests = { 0: { value: 1, sent: true, afterFrame: 10 }, 1: { value: 1, sent: false, afterFrame: 10 } };
    const frame = { frameId: 10, solenoids: [1, 1, 0, 0], serial_connected: true };
    assert.equal(resolveValveRequests(requests, frame), requests);
    assert.equal(resolveValveRequests(requests, { ...frame, frameId: 11, serial_connected: false }), requests);
    assert.equal(resolveValveRequests(requests, { ...frame, frameId: 11, solenoids: [0, 1, 0, 0] }), requests);
    assert.deepEqual(resolveValveRequests(requests, { ...frame, frameId: 11 }), { 1: requests[1] });
});


test('known solenoids show waiting only at the one-second boundary', () => {
    const requests = { 0: { value: 1, requestedAt: 500 }, 1: { value: 0, requestedAt: 900 } };
    assert.deepEqual(waitingValveRequests(requests, [0, 1, 0, 0], true, 1499), {});
    assert.deepEqual(waitingValveRequests(requests, [0, 1, 0, 0], true, 1500), { 0: requests[0] });
    assert.deepEqual(waitingValveRequests(requests, [0, 1, 0, 0], true, 1900), requests);
});

test('unknown or unavailable solenoids show waiting immediately', () => {
    const requests = { 0: { value: 1, requestedAt: 500 } };
    assert.deepEqual(waitingValveRequests(requests, [null, 0, 0, 0], true, 500), requests);
    assert.deepEqual(waitingValveRequests(requests, [0, 0, 0, 0], false, 500), requests);
    assert.deepEqual(waitingValveRequests({}, [null, null, null, null], false, 500), {});
});

test('resolved requests stay hidden and a replacement gets its own full delay', () => {
    const original = { 0: { value: 1, sent: true, afterFrame: 10, requestedAt: 500 } };
    const resolved = resolveValveRequests(original, { frameId: 11, solenoids: [1, 0, 0, 0], serial_connected: true });
    assert.deepEqual(waitingValveRequests(resolved, [1, 0, 0, 0], true, 2000), {});
    const replaced = { 0: { ...original[0], value: 0, requestedAt: 1400 } };
    assert.deepEqual(waitingValveRequests(replaced, [1, 0, 0, 0], true, 1500), {});
    assert.deepEqual(waitingValveRequests(replaced, [1, 0, 0, 0], true, 2400), replaced);
});
