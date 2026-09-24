export const HISTORY_WINDOWS = [3, 5, 10];
export const AVERAGE_SECONDS = 1;

// O(n) trailing sample mean over a time interval, independent of chart zoom.
// Invalid readings leave raw gaps; the average uses valid samples still in its window.
export function buildHistorySeries(history, windowSeconds = 5) {
    const newest = history.at(-1)?.time;
    if (!Number.isFinite(newest)) return [];
    const cutoff = newest - windowSeconds;
    const points = [];
    let left = 0;
    let sum = 0;
    let count = 0;
    for (let right = 0; right < history.length; right++) {
        const point = history[right];
        if (Number.isFinite(point.value)) { sum += point.value; count++; }
        while (left <= right && history[left].time < point.time - AVERAGE_SECONDS - 1e-9) {
            if (Number.isFinite(history[left].value)) { sum -= history[left].value; count--; }
            left++;
        }
        if (point.time < cutoff - 1e-9) continue;
        // A telemetry outage must not become a straight line between sessions.
        const previous = history[right - 1];
        if (previous && point.time - previous.time > 2) {
            points.push({ time: Math.max(cutoff, previous.time + 0.001), elapsed: Math.max(cutoff, previous.time + 0.001) - newest, value: null, average: null });
        }
        points.push({
            time: point.time,
            elapsed: point.time - newest,
            value: Number.isFinite(point.value) ? point.value : null,
            average: count ? sum / count : null,
        });
    }
    return points;
}
