import { COUNTS } from './config.js';

const modes = ['fixed', 'sine', 'ramp', 'noise', 'walk'];
const signals = { solenoids: 4, keys: 1, burn: 1 };
const binary = value => value === 0 || value === 1;
export const validCommand = value => Number.isInteger(value) && value >= 0 && value <= 10;

// Update only the edited field, so separate panels cannot overwrite unrelated edits.
export function applyPatch(config, path, value) {
    if (!Array.isArray(path)) return null;
    const [group, channel, index, field] = path;
    if (group === 'channels' && path.length === 4) {
        if (!Object.hasOwn(COUNTS, channel) || !Number.isInteger(index) || index < 0 || index >= COUNTS[channel]) return null;
        const valid = field === 'mode' ? modes.includes(value)
            : field === 'value' ? Number.isFinite(value)
            : field === 'amp' ? Number.isFinite(value) && value >= 0
            : field === 'period' ? Number.isFinite(value) && value >= 0.05 : false;
        if (!valid) return null;
        const next = structuredClone(config);
        next.channels[channel][index][field] = value;
        return next;
    }
    if (path.length === 2 && Object.hasOwn(signals, group)) {
        if (!Number.isInteger(channel) || channel < 0 || channel >= signals[group] || !binary(value)) return null;
        const next = structuredClone(config);
        next[group][channel] = value;
        return next;
    }
    if (path.length !== 1) return null;
    const valid = ['running', 'autoSequence', 'serialConnected'].includes(group) ? typeof value === 'boolean'
        : group === 'going' ? binary(value)
        : group === 'state' ? Number.isInteger(value) && value >= 0 && value <= 5
        : group === 'rate' ? Number.isInteger(value) && value >= 1 && value <= 120 : false;
    return valid ? { ...config, [group]: value } : null;
}
