import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import { manualConfig } from '../mock-server/config.js';
import { applyPatch } from '../mock-server/patch.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('manual configuration holds every channel fixed and rejects invalid edits', () => {
    const config = manualConfig();
    assert.equal(config.autoSequence, false);
    for (const channels of Object.values(config.channels)) for (const channel of channels) assert.equal(channel.mode, 'fixed');
    for (const [path, value] of [
        [['channels', 'pressures', 12, 'value'], 1],
        [['channels', 'temps', 0, 'value'], Infinity],
        [['channels', 'temps', 0, 'mode'], 'bad'],
        [['channels', 'temps', 0, 'period'], 0],
        [['channels', 'temps', 0, 'amp'], -1],
        [['solenoids', 0], 2], [['state'], 6], [['rate'], 0], [['rate'], 0.5],
        [['serialConnected'], 0], [['__proto__'], {}],
    ]) assert.equal(applyPatch(config, path, value), null);
    assert.equal(applyPatch(config, ['channels', 'pressures', 0, 'value'], -1).channels.pressures[0].value, -1);
    assert.equal(config.channels.pressures[0].value, 0.9);
});

function inbox(ws) {
    const messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw)));
    return {
        messages,
        async wait(predicate, start = 0) {
            const deadline = Date.now() + 3000;
            while (Date.now() < deadline) {
                const found = messages.slice(start).find(predicate);
                if (found) return found;
                await delay(10);
            }
            throw new Error('Timed out waiting for mock telemetry');
        },
    };
}

test('standalone bench edits reach telemetry and simulate commands and connection states', { timeout: 15000 }, async t => {
    const child = spawn(process.execPath, ['mock-server/server.js'], {
        env: { ...process.env, MOCK_PORT: '0', MOCK_MANUAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const clients = [];
    t.after(async () => {
        for (const ws of clients) ws.terminate();
        if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    });
    const port = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Mock failed to start')), 4000);
        child.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/control panel\s+http:\/\/localhost:(\d+)/);
            if (match) { clearTimeout(timer); resolve(Number(match[1])); }
        });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('exit', code => { clearTimeout(timer); reject(new Error(`Mock exited: ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { service: 'alpha-mock', manual: true });
    assert.match(await (await fetch(base)).text(), /Telemetry Bench/);
    assert.equal((await fetch(`${base}/server.js`)).status, 404);
    async function client(route) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/${route}`);
        clients.push(ws);
        const box = inbox(ws);
        await once(ws, 'open');
        return { ws, box };
    }
    const panel = await client('control');
    const second = await client('control');
    const data = await client('data');
    const hello = await panel.box.wait(message => message.type === 'hello');
    assert.equal(hello.config.autoSequence, false);
    const patch = (path, value, target = panel) => target.ws.send(JSON.stringify({ type: 'patch', path, value }));
    const changes = [['temps', 0, -12.75], ['pressures', 1, 655.25], ['thrusts', 0, 321], ['acc', 2, -45]];
    for (const [group, index, value] of changes) patch(['channels', group, index, 'value'], value);
    patch(['channels', 'pressures', 11, 'value'], 333, second);
    const edited = await data.box.wait(frame => changes.every(([group, index, value]) => frame[group][index] === value) && frame.pressures[11] === 333);
    assert.equal(edited.serial_connected, true);
    assert.ok(Number.isFinite(edited.time));
    await second.box.wait(message => message.config?.channels.pressures[1].value === 655.25);

    for (const [path, value, matches] of [
        [['serialConnected'], false, frame => frame.serial_connected === false],
        [['keys', 0], 0, frame => frame.keys[0] === 0],
        [['burn', 0], 0, frame => frame.burn[0] === 0],
        [['solenoids', 2], 1, frame => frame.solenoids[2] === 1],
        [['state'], 4, frame => frame.state === 4],
        [['going'], 1, frame => frame.going === 1],
    ]) {
        const start = data.box.messages.length;
        patch(path, value);
        await data.box.wait(matches, start);
    }
    patch(['serialConnected'], true);
    await data.box.wait(frame => frame.serial_connected === true && frame.state === 4);
    for (const [command, expected] of [[8, 1], [10, 5], [9, 0]]) {
        const start = data.box.messages.length;
        data.ws.send(JSON.stringify({ command }));
        await data.box.wait(frame => frame.state === expected, start);
    }
    await panel.box.wait(message => message.log?.[0]?.name === 'RST');
    patch(['running'], false);
    await panel.box.wait(message => message.config?.running === false);
    const pong = once(data.ws, 'pong'); data.ws.ping(); await pong;
    const count = data.box.messages.length;
    await delay(120);
    assert.equal(data.box.messages.length, count, 'Pause must stop telemetry frames');
    patch(['running'], true);
    await data.box.wait(() => true, count);
    patch(['channels', 'temps', 99, 'value'], 20);
    await panel.box.wait(message => message.type === 'error');
    // A rejected edit must leave the stream healthy and previous manual values intact.
    const afterError = data.box.messages.length;
    await data.box.wait(frame => frame.temps[0] === -12.75, afterError);
});
