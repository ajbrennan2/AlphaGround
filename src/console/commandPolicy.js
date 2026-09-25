export const COMMANDS = { FIRE: 8, RESET: 9, ABORT: 10 };

// All command entry points (buttons, SVG, keyboard) use the same policy.
// An open transport can still carry ABORT when telemetry has stopped arriving.
export function commandBlockReason(command, context) {
    if (!Number.isInteger(command) || command < 0 || command > 10) return 'Unknown command.';
    // Valve requests remain interactive offline; the caller records unsent intent.
    if (command < 8) return context.locked ? 'Unlock solenoids before sending a valve command.' : null;
    if (!context.connected) return 'No connection. Command was not sent.';
    if (context.serialConnected === false) return 'Serial link unavailable. Command was not sent.';
    if (command === COMMANDS.ABORT) return null;
    if (!context.fresh) return 'Waiting for current telemetry. Command was not sent.';
    if (command === COMMANDS.FIRE && (!context.fireEnabled || context.state !== 0)) {
        return 'Enable ignition while in standby before sending FIRE.';
    }
    if (command === COMMANDS.RESET && context.state !== 5) return 'Reset is available in the abort state.';
    return null;
}

export function solenoidCommand(index, value) {
    if (!Number.isInteger(index) || index < 0 || index > 3 || (value !== null && value !== 0 && value !== 1)) return null;
    return index * 2 + (value === 1 ? 1 : 0);
}

export function shortcutSolenoid(event) {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
    if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return null;
    return /^[1-4]$/.test(event.key) ? Number(event.key) - 1 : null;
}
