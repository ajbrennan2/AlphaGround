import { memo, useMemo, useState } from 'react';
import { useHistory } from '../useTelemetry';
import { buildHistorySeries, HISTORY_WINDOWS } from '../history';
import { chartGeometry } from '../chartGeometry';
import { GROUPS, channelName, reading } from './presentation';
import './graphical-telemetry.css';

const COLORS = { pressures: '#8cc9da', temps: '#e3b588', thrusts: '#ebce6a', acc: '#b7ace5' };
const axisLabel = value => Number(value.toPrecision(4)).toString();

const SensorChart = memo(function SensorChart({ group, index, history, seconds, averages, stale, paused }) {
    const series = useMemo(() => buildHistorySeries(history, seconds), [history, seconds]);
    const geometry = useMemo(() => chartGeometry(series, 316, seconds, 120), [series, seconds]);
    const name = channelName(group, index);
    const current = series.at(-1)?.value;
    return <article className={`cf-chart${stale ? ' is-stale' : ''}`} aria-label={`${name} history`}>
        <header><h3><i />{name}</h3><div><strong>{reading(current)}</strong><span>{GROUPS[group].unit}</span></div></header>
        <div className="cf-plot">
            <div className="cf-y-axis"><span>{axisLabel(geometry.max)}</span><span>{axisLabel(geometry.min)}</span></div>
            <svg viewBox="62 16 240 76" preserveAspectRatio="none" role="img" aria-label={`${name}: ${reading(current)} ${GROUPS[group].unit}. ${seconds} seconds of retained telemetry${stale ? ', stale' : ''}${paused ? ', display paused' : ''}.`}>
                {[16, 54, 92].map(y => <line key={y} x1="62" x2="302" y1={y} y2={y} className="cf-gridline" />)}
                <path d={geometry.current} className="cf-signal" vectorEffect="non-scaling-stroke" />
                {averages && <path d={geometry.average} className="cf-average" vectorEffect="non-scaling-stroke" />}
            </svg>
            {!history.length && <span className="cf-empty">Waiting for samples</span>}
        </div>
        <footer><span>−{seconds}s</span><span>{stale ? 'Stale' : paused ? 'Paused' : 'Now'}</span></footer>
    </article>;
});

function LiveSensorChart({ store, group, index, ...props }) {
    const history = useHistory(store, group, index);
    return <SensorChart {...props} group={group} index={index} history={history} />;
}

function ChartGroup({ group, children }) {
    const config = GROUPS[group];
    return <section className="cf-group" aria-label={`${config.label} charts`} style={{ '--signal': COLORS[group] }}>
        <div className="cf-group-heading"><h2>{config.label}</h2><span>{config.count} {config.count === 1 ? 'channel' : 'channels'} · {config.unit === 'raw' ? 'raw units' : 'degrees'}</span></div>
        <div className="cf-chart-grid">{children}</div>
    </section>;
}

export default function GraphicalTelemetry({ store, stale, events }) {
    const [seconds, setSeconds] = useState(5);
    const [averages, setAverages] = useState(true);
    const [frozen, setFrozen] = useState(null);
    function togglePause() {
        setFrozen(previous => previous ? null : Object.fromEntries(Object.entries(GROUPS).flatMap(([group, config]) =>
            Array.from({ length: config.count }, (_, index) => {
                const key = `${group}.${index}`;
                return [key, store.getHistory(key)];
            }))));
    }
    const charts = group => <ChartGroup group={group}>{Array.from({ length: GROUPS[group].count }, (_, index) => {
        const key = `${group}.${index}`;
        const props = { group, index, seconds, averages, stale, paused: !!frozen };
        return frozen ? <SensorChart key={key} {...props} history={frozen[key]} /> : <LiveSensorChart key={key} {...props} store={store} />;
    })}</ChartGroup>;
    return <section className="cf-main" aria-label="Graphical telemetry">
        <header className="cf-toolbar"><div><h1>Telemetry overview</h1><p>20 channels · {frozen ? 'Display paused · acquisition continues' : 'All signals in view'}</p></div><div className="cf-chart-tools">
            <label className="cf-average-toggle"><input type="checkbox" checked={averages} onChange={event => setAverages(event.target.checked)} /><span className="cf-average-swatch" />1s average</label>
            <div className="cf-time-range" role="group" aria-label="Chart time window">{HISTORY_WINDOWS.map(value => <button key={value} aria-pressed={seconds === value} onClick={() => setSeconds(value)}>{value}s</button>)}</div>
            <button className="cf-pause" aria-pressed={!!frozen} onClick={togglePause}>{frozen ? 'Resume charts' : 'Pause charts'}</button>
        </div></header>
        {stale && <p className="cf-disconnected" role="status">Telemetry unavailable. Retained readings are stale; waiting for valid samples.</p>}
        <div className="cf-chart-deck">{charts('pressures')}{charts('temps')}<div className="cf-bottom-groups">{charts('thrusts')}{charts('acc')}</div></div>
        <details className="cf-activity"><summary>Activity{events.length ? ` · ${events[0].message}` : ' · No commands sent'}</summary><ol>{events.map((event, index) => <li key={`${event.time}-${index}`}><time>{event.time}</time> {event.message}</li>)}</ol></details>
        <p className="console-sr-only" role="status">{events[0]?.message ?? 'No commands sent.'}</p>
    </section>;
}
