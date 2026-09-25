// Acquisition stays at wire speed. React sees stable snapshots at display speed.
export const CHANNEL_COUNTS = { temps: 4, pressures: 12, thrusts: 1, acc: 3 };
const GROUP_COUNTS = { ...CHANNEL_COUNTS, solenoids: 4, keys: 1, burn: 1 };
// Twelve seconds at 120 Hz: a full 10s view plus averaging context.
export const HISTORY_CAPACITY = 1440;
export const HISTORY_INTERVAL_MS = 100;
export const DISPLAY_INTERVAL_MS = 33;

export class HistoryBuffer {
    constructor(capacity = HISTORY_CAPACITY) {
        if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("Invalid capacity");
        this.capacity = capacity;
        this.values = new Float64Array(capacity);
        this.times = new Float64Array(capacity);
        this.length = 0;
        this.cursor = 0;
        this.version = 0;
    }

    push(value, time) {
        const last = (this.cursor - 1 + this.capacity) % this.capacity;
        // A restarted backend clock begins a new history rather than mixing epochs.
        if (this.length && time < this.times[last]) {
            this.length = 0;
            this.cursor = 0;
        }
        this.values[this.cursor] = Number.isFinite(value) ? value : NaN;
        this.times[this.cursor] = time;
        this.cursor = (this.cursor + 1) % this.capacity;
        this.length = Math.min(this.length + 1, this.capacity);
        this.version++;
    }

    snapshot() {
        const points = new Array(this.length);
        for (let i = 0; i < this.length; i++) {
            const index = (this.cursor - this.length + i + this.capacity) % this.capacity;
            points[i] = {
                time: this.times[index],
                value: Number.isFinite(this.values[index]) ? this.values[index] : null,
            };
        }
        return points;
    }
}

function sameValues(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createTelemetryStore() {
    let latest = {
        ...Object.fromEntries(Object.entries(GROUP_COUNTS).map(([key, count]) => [key, Array(count).fill(null)])),
        state: null,
        going: null,
        serial_connected: null,
    };
    let frameId = 0;
    let published = latest;
    const listeners = new Map();
    const histories = new Map();
    for (const [group, count] of Object.entries(CHANNEL_COUNTS)) {
        for (let index = 0; index < count; index++) {
            histories.set(`${group}.${index}`, { buffer: new HistoryBuffer(), version: 0, snapshot: null, lastPublishedAt: -Infinity });
        }
    }

    function subscribe(key, listener) {
        if (!listeners.has(key)) listeners.set(key, new Set());
        listeners.get(key).add(listener);
        return () => {
            const subscriptions = listeners.get(key);
            subscriptions.delete(listener);
            if (!subscriptions.size) {
                listeners.delete(key);
                const history = histories.get(key);
                if (history) {
                    history.snapshot = null;
                    history.lastPublishedAt = -Infinity;
                }
            }
        };
    }

    function notify(key) {
        listeners.get(key)?.forEach(listener => listener());
    }

    function refreshHistory(history) {
        history.snapshot = history.buffer.snapshot();
        history.version = history.buffer.version;
        return history.snapshot;
    }

    function getHistory(key) {
        const history = histories.get(key);
        // Mounted views see a stable snapshot until the next 10 Hz publication.
        // Otherwise React's snapshot checks would undo the chart throttle.
        if (history.snapshot === null || (!listeners.has(key) && history.version !== history.buffer.version)) {
            return refreshHistory(history);
        }
        return history.snapshot;
    }

    return {
        subscribe,
        reset() {
            latest = {
                ...Object.fromEntries(Object.entries(GROUP_COUNTS).map(([key, count]) => [key, Array(count).fill(null)])),
                state: null, going: null, serial_connected: null, frameId: ++frameId,
            };
            published = latest;
            for (const history of histories.values()) {
                history.buffer = new HistoryBuffer();
                history.snapshot = null;
                history.version = 0;
                history.lastPublishedAt = -Infinity;
            }
            for (const key of listeners.keys()) notify(key);
        },
        getLatest: () => latest,
        getSnapshot: key => published[key],
        getHistory,
        ingest(frame, receivedAt = Date.now() / 1000) {
            if (!frame || typeof frame !== "object") return false;
            // Reject incomplete frames instead of crashing the socket handler or
            // displaying a mixture of new and stale sensor groups.
            for (const [group, count] of Object.entries(GROUP_COUNTS)) {
                if (!Array.isArray(frame[group]) || frame[group].length !== count) return false;
            }
            const next = {};
            for (const group of Object.keys(GROUP_COUNTS)) {
                const values = frame[group].map(value => {
                    if (!Number.isFinite(value)) return null;
                    if (["solenoids", "keys", "burn"].includes(group) && value !== 0 && value !== 1) return null;
                    return value;
                });
                next[group] = sameValues(values, latest[group]) ? latest[group] : values;
            }
            next.state = Number.isInteger(frame.state) && frame.state >= 0 && frame.state <= 5 ? frame.state : null;
            next.going = frame.going === 0 || frame.going === 1 ? frame.going : null;
            next.serial_connected = typeof frame.serial_connected === "boolean" ? frame.serial_connected : null;
            next.frameId = ++frameId;
            const time = Number.isFinite(frame.time) ? frame.time : receivedAt;
            for (const [group, count] of Object.entries(CHANNEL_COUNTS)) {
                for (let index = 0; index < count; index++) {
                    histories.get(`${group}.${index}`).buffer.push(next.serial_connected === false ? null : next[group][index], time);
                }
            }
            latest = next;
            return true;
        },
        publish(now = performance.now()) {
            const previous = published;
            published = latest;
            for (const key of Object.keys(published)) {
                if (published[key] !== previous[key]) notify(key);
            }
            for (const [key, history] of histories) {
                if (listeners.has(key) && history.version !== history.buffer.version && now - history.lastPublishedAt >= HISTORY_INTERVAL_MS) {
                    refreshHistory(history);
                    history.lastPublishedAt = now;
                    notify(key);
                }
            }
        },
    };
}
