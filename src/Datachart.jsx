import { memo, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useHistory } from './useTelemetry';
import { buildHistorySeries } from './history';
import { CHART_HEIGHT, CHART_PADDING, chartGeometry, nearestPoint } from './chartGeometry';

const format = value => Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '--';

const HistoryPlot = memo(function HistoryPlot({ data, windowSeconds }) {
    const host = useRef(null);
    const id = useId();
    const [size, setSize] = useState({ width: 700, height: CHART_HEIGHT });
    const { width, height } = size;
    const [cursor, setCursor] = useState(null);
    useEffect(() => {
        const observer = new ResizeObserver(entries => {
            const rect = entries[0].contentRect;
            const next = { width: Math.max(180, Math.round(rect.width)), height: Math.max(90, Math.round(rect.height) - 18) };
            setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
        });
        observer.observe(host.current);
        return () => observer.disconnect();
    }, []);
    const geometry = useMemo(() => chartGeometry(data, width, windowSeconds, height), [data, width, windowSeconds, height]);
    const hover = cursor === null ? null : nearestPoint(data, cursor);
    const right = width - CHART_PADDING.right;
    const bottom = height - CHART_PADDING.bottom;
    function pointAt(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * width;
        setCursor(Math.max(-windowSeconds, Math.min(0, (x - CHART_PADDING.left) / (right - CHART_PADDING.left) * windowSeconds - windowSeconds)));
    }
    return <div ref={host} className="console-chart">
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title`} onPointerMove={pointAt} onPointerLeave={() => setCursor(null)}>
            <title id={`${id}-title`}>{`Last ${windowSeconds} seconds. Solid line: signal. Dashed line: one-second rolling average.`}</title>
            <defs><clipPath id={`${id}-clip`}><rect x={CHART_PADDING.left} y={CHART_PADDING.top} width={right - CHART_PADDING.left} height={bottom - CHART_PADDING.top} /></clipPath></defs>
            {[0, 1, 2, 3, 4].map(i => {
                const value = geometry.max - (geometry.max - geometry.min) * i / 4;
                const y = geometry.y(value);
                const time = -windowSeconds + windowSeconds * i / 4;
                return <g key={i}>
                    <line x1={CHART_PADDING.left} x2={right} y1={y} y2={y} className="console-chart-grid" />
                    <text x={CHART_PADDING.left - 8} y={y + 4} textAnchor="end">{format(value)}</text>
                    <text x={geometry.x(time)} y={height - 7} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{time === 0 ? 'Now' : `${time}s`}</text>
                </g>;
            })}
            <g clipPath={`url(#${id}-clip)`} fill="none" strokeLinejoin="round" strokeLinecap="round">
                <path d={geometry.current} stroke="var(--yellow, #ebce6a)" strokeWidth="1.3" />
                <path d={geometry.average} stroke="var(--average, #8cc9da)" strokeWidth="2" strokeDasharray="5 3" />
                {hover && <line x1={geometry.x(hover.elapsed)} x2={geometry.x(hover.elapsed)} y1={CHART_PADDING.top} y2={bottom} className="console-chart-cursor" />}
            </g>
        </svg>
        <output className="console-chart-hover">{hover ? `${hover.elapsed.toFixed(2)}s · Current ${format(hover.value)} · 1s avg ${format(hover.average)}` : '\u00a0'}</output>
    </div>;
});

function StoreChart({ store, group, index, windowSeconds }) {
    const history = useHistory(store, group, index);
    const data = useMemo(() => buildHistorySeries(history, windowSeconds), [history, windowSeconds]);
    return <HistoryPlot data={data} windowSeconds={windowSeconds} />;
}

const Datachart = memo(function Datachart({ data, windowSeconds = 5, ...props }) {
    return data ? <HistoryPlot data={data} windowSeconds={windowSeconds} /> : <StoreChart {...props} windowSeconds={windowSeconds} />;
});
export default Datachart;
