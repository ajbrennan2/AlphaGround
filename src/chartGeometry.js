export const CHART_HEIGHT = 220;
export const CHART_PADDING = { left: 62, right: 14, top: 16, bottom: 28 };

// Two bounded SVG paths, without a chart-library scene/store for every sample.
export function chartGeometry(data, width, windowSeconds, height = CHART_HEIGHT) {
    let min = Infinity;
    let max = -Infinity;
    for (const point of data) {
        for (const key of ['value', 'average']) {
            const value = point[key];
            if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
        }
    }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    // Keep near-constant sensor noise from expanding to the full plot height.
    const minimumSpan = Math.max(Math.abs(min), Math.abs(max)) * 0.1 || 2;
    const span = Math.max(max - min, minimumSpan, 2);
    const center = (max + min) / 2;
    min = center - span / 2;
    max = center + span / 2;
    const padding = span * 0.08;
    min -= padding;
    max += padding;
    const x = elapsed => CHART_PADDING.left + (elapsed + windowSeconds) / windowSeconds * (width - CHART_PADDING.left - CHART_PADDING.right);
    const y = value => CHART_PADDING.top + (max - value) / (max - min) * (height - CHART_PADDING.top - CHART_PADDING.bottom);
    function path(key) {
        let drawing = false;
        let result = '';
        for (let index = 0; index < data.length; index++) {
            const point = data[index];
            if (!Number.isFinite(point[key])) { drawing = false; continue; }
            result += `${drawing ? 'L' : 'M'}${x(point.elapsed).toFixed(1)},${y(point[key]).toFixed(1)}`;
            // A lone valid sample between gaps needs a visible round-capped dot.
            if (!drawing && !Number.isFinite(data[index + 1]?.[key])) {
                result += `L${x(point.elapsed).toFixed(1)},${y(point[key]).toFixed(1)}`;
            }
            drawing = true;
        }
        return result;
    }
    return { min, max, x, y, current: path('value'), average: path('average') };
}

export function nearestPoint(data, elapsed) {
    if (!data.length) return null;
    let left = 0;
    let right = data.length - 1;
    while (left < right) {
        const middle = Math.floor((left + right) / 2);
        if (data[middle].elapsed < elapsed) left = middle + 1;
        else right = middle;
    }
    return left > 0 && Math.abs(data[left - 1].elapsed - elapsed) < Math.abs(data[left].elapsed - elapsed) ? data[left - 1] : data[left];
}
