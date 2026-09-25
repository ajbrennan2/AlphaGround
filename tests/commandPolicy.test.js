import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, commandBlockReason, shortcutSolenoid, solenoidCommand } from '../src/console/commandPolicy.js';

const ready = { connected: true, fresh: true, serialConnected: true, locked: false, fireEnabled: true, state: 0, solenoids: [0, 1, 0, 1] };

test('valve commands retain the wire mapping and allow an explicit open request from unknown', () => {
    for (let index = 0; index < 4; index++) {
        assert.equal(solenoidCommand(index, 0), index * 2);
        assert.equal(solenoidCommand(index, 1), index * 2 + 1);
        assert.equal(solenoidCommand(index, null), index * 2);
    }
    assert.equal(solenoidCommand(-1, 0), null);
    assert.equal(solenoidCommand(4, 0), null);
    assert.equal(commandBlockReason(0, { ...ready, solenoids: [null, 0, 0, 0] }), null);
});

test('all eight valve requests respect locks while remaining interactive offline', () => {
    for (let command = 0; command < 8; command++) {
        assert.equal(commandBlockReason(command, ready), null);
        assert.ok(commandBlockReason(command, { ...ready, locked: true }));
        for (const override of [{ fresh: false }, { connected: false }, { serialConnected: false }]) {
            assert.equal(commandBlockReason(command, { ...ready, ...override }), null);
        }
    }
});

test('fire requires an explicit enable and a board-reported standby state', () => {
    assert.equal(commandBlockReason(COMMANDS.FIRE, ready), null);
    assert.ok(commandBlockReason(COMMANDS.FIRE, { ...ready, fireEnabled: false }));
    for (const state of [null, 1, 2, 3, 4, 5]) {
        assert.ok(commandBlockReason(COMMANDS.FIRE, { ...ready, state }));
    }
    assert.ok(commandBlockReason(COMMANDS.FIRE, { ...ready, fresh: false }));
});

test('abort stays independent of locks and stale telemetry while transport is available', () => {
    assert.equal(commandBlockReason(COMMANDS.ABORT, { ...ready, fresh: false, locked: true, fireEnabled: false, state: null }), null);
    assert.ok(commandBlockReason(COMMANDS.ABORT, { ...ready, connected: false }));
    assert.ok(commandBlockReason(COMMANDS.ABORT, { ...ready, serialConnected: false }));
});

test('reset requires the abort state and invalid command values never pass', () => {
    assert.equal(commandBlockReason(COMMANDS.RESET, { ...ready, state: 5 }), null);
    assert.ok(commandBlockReason(COMMANDS.RESET, ready));
    for (const command of [null, undefined, -1, 11, 0.5, '8']) assert.ok(commandBlockReason(command, ready));
});

test('keyboard shortcuts ignore typing, held keys, and modifiers', () => {
    assert.equal(shortcutSolenoid({ key: '1' }), 0);
    assert.equal(shortcutSolenoid({ key: '4' }), 3);
    assert.equal(shortcutSolenoid({ key: '5' }), null);
    for (const override of [{ repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true }, { target: { closest: () => ({}) } }]) {
        assert.equal(shortcutSolenoid({ key: '1', ...override }), null);
    }
});
