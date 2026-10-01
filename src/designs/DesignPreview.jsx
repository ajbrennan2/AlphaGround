import { useId, useMemo, useRef, useState } from 'react';
import './design-preview.css';
import Plumbing from '../Plumbing';

const DESIGNS = {
    console: { name: 'Console', title: 'The system at a glance.', description: 'Flow first. Ignition in view. Every sensor one click away.' },
    field: { name: 'Field', title: 'Clear in the daylight.', description: 'A bright schematic, prominent ignition status, and all readings together.' },
    analysis: { name: 'Analysis', title: 'System context. Signal detail.', description: 'The flow diagram leads, with every channel and deeper history directly below.' },
};
const GROUPS = { pressures: { label: 'Pressures', prefix: 'PT', count: 12, unit: 'raw' }, temps: { label: 'Temperatures', prefix: 'TC', count: 4, unit: 'raw' }, thrusts: { label: 'Thrust', prefix: 'LC', count: 1, unit: 'raw' }, acc: { label: 'Orientation', prefix: '', count: 3, unit: '°' } };
const STAGES = [
    { id: 'standby', label: 'Standby', description: 'Awaiting a fire command.' },
    { id: 'received', label: 'Fire received', description: 'Fire command received by the sequence.' },
    { id: 'ignite', label: 'Ignite', description: 'Ignition phase active.' },
    { id: 'burning', label: 'Burning', description: 'Burn phase active.' },
    { id: 'cooldown', label: 'Cooldown', description: 'Cooldown phase active.' },
];
const LABELS = ['Yaw', 'Pitch', 'Roll'];
const BASE = { pressures: [2.4, 620, 440, 420, 400, 380, 360, 340, 320, 300, 280, 260], temps: [22.4, 23.1, 22.8, 24.2], thrusts: [4.2], acc: [0.8, -0.4, 1.2] };
const BURN = { pressures: [2.8, 584, 431, 411, 391, 370, 352, 330, 312, 288, 270, 250], temps: [34.2, 41.8, 29.4, 36.7], thrusts: [842.6], acc: [1.4, -0.8, 1.9] };
function channelName(group, i) { return group === 'acc' ? LABELS[i] : `${GROUPS[group].prefix}-${String(i + 1).padStart(2, '0')}`; }

function Icon({ name, size = 18 }) {
    const paths = {
        lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
        signal: <><path d="M4 19v-3m5 3v-7m5 7V8m5 11V4"/></>,
        chart: <><path d="M3 3v18h18M6 15l4-5 4 3 6-8"/></>,
        arrow: <><path d="M5 12h14m-5-5 5 5-5 5"/></>,
        check: <path d="m5 12 4 4L19 6"/>,
        stop: <rect x="5" y="5" width="14" height="14" rx="2"/>,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function PanelHeader({ title, detail, children }) {
    return <div className="dp-panel-head"><h2>{title}</h2>{detail && <span>{detail}</span>}{children}</div>;
}
function Status({ children, tone = 'good' }) { return <span className={`dp-status ${tone}`}><i />{children}</span>; }

function Plot({ group, index, data, windowSeconds, secondary = false }) {
    const id = useId();
    const baseline = data[group][index];
    const amplitude = Math.max(Math.abs(baseline) * 0.04, 0.3);
    const minimum = baseline - amplitude * 2.5;
    const maximum = baseline + amplitude * 2.5;
    const values = Array.from({ length: 121 }, (_, i) => baseline + amplitude * (Math.sin(i * windowSeconds / 180 + index) * 0.65 + Math.cos(i * 0.7) * 0.17 + Math.sin(i * 1.9) * 0.08));
    const points = values.map((value, i) => `${55 + i * 5.15},${24 + (maximum - value) / (maximum - minimum) * 142}`).join(' ');
    return <svg className={`dp-plot ${secondary ? 'secondary' : ''}`} viewBox="0 0 700 203" role="img" aria-labelledby={id}>
        <title id={id}>{channelName(group, index)} sample history over {windowSeconds} seconds, in {GROUPS[group].unit === 'raw' ? 'unverified native units' : 'degrees'}</title>
        {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="55" x2="674" y1={24 + i * 35.5} y2={24 + i * 35.5} className="dp-gridline"/><text x="43" y={28 + i * 35.5} textAnchor="end">{(maximum - i / 4 * (maximum - minimum)).toFixed(Math.abs(baseline) > 100 ? 0 : 1)}</text></g>)}
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
        {[0, 1, 2, 3, 4].map(i => <text key={i} x={55 + i * 154.75} y="191" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}>{i === 4 ? 'Now' : `−${windowSeconds - i * windowSeconds / 4}s`}</text>)}
    </svg>;
}

function FlowDiagram({ data, valves, stale, locked, sendCommand }) {
    const store = useMemo(() => {
        const frame = { ...data, solenoids: valves.map(Number) };
        return { getSnapshot: key => frame[key], getLatest: () => frame, subscribe: () => () => {} };
    }, [data, valves]);
    return <div className="dp-original-flow"><Plumbing store={store} sendCommand={sendCommand} controlsDisabled={locked || stale} stale={stale} /></div>;
}

export default function DesignPreview() {
    const requested = new URLSearchParams(window.location.search).get('design');
    const [design, setDesign] = useState(Object.hasOwn(DESIGNS, requested) ? requested : 'console');
    const [scenario, setScenario] = useState('standby');
    const historyRef = useRef(null);
    const [sample, setSample] = useState(BASE);
    const [group, setGroup] = useState('pressures');
    const [selected, setSelected] = useState(1);
    const [windowSeconds, setWindowSeconds] = useState(60);
    const [locked, setLocked] = useState(true);
    const [armed, setArmed] = useState(false);
    const [valves, setValves] = useState([false, false, false, false]);
    const [events, setEvents] = useState([{ time: '12:04:00', message: 'Preview loaded · standby sample' }]);
    const stale = scenario === 'disconnected';
    const burning = scenario === 'burning';
    const aborted = scenario === 'abort';
    const data = sample;
    const concept = DESIGNS[design];
    const stage = STAGES.find(item => item.id === scenario);
    const state = stale ? 'Unknown' : aborted ? 'Aborted' : stage.label;
    const sequenceBusy = ['received', 'ignite', 'burning', 'cooldown'].includes(scenario);
    const sequenceDescription = stale ? 'Link lost. Sequence state cannot be confirmed.' : aborted ? 'Sequence stopped. Reset to return to standby.' : stage.description;
    function log(message) {
        setEvents(previous => [{ time: new Date().toLocaleTimeString('en-GB', { hour12: false }), message }, ...previous].slice(0, 5));
    }
    function chooseDesign(next) {
        setDesign(next);
        const url = new URL(window.location.href);
        url.searchParams.set('design', next);
        window.history.replaceState(null, '', url);
    }
    function chooseScenario(next) {
        setScenario(next); setLocked(true); setArmed(false);
        if (next !== 'disconnected') {
            setSample(next === 'burning' ? BURN : BASE);
            setValves(next === 'burning' ? [true, false, true, true] : [false, false, false, false]);
        }
        log(`${STAGES.find(item => item.id === next)?.label ?? (next === 'abort' ? 'Abort' : 'Connection lost')} sample selected`);
    }
    function inspectSensor(nextGroup, index) {
        setGroup(nextGroup);
        setSelected(index);
        historyRef.current?.focus({ preventScroll: true });
        historyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }

    const channels = <section id="all-sensors" className="dp-panel dp-channels" aria-label="All sensor readings">
        <PanelHeader title="All telemetry" detail={stale ? '20 sensors · last-known values' : '20 sensors · select any reading for history'}/>
        <div className="dp-channel-groups">{Object.entries(GROUPS).map(([key, config]) => <section key={key} className={`dp-channel-group dp-group-${key}`} aria-labelledby={`heading-${key}`}>
            <div className="dp-table-heading"><h3 id={`heading-${key}`}>{config.label} <small>{config.count}</small></h3><span>{config.unit === 'raw' ? 'Native units*' : 'Degrees'}</span></div>
            <div className="dp-sensor-list">{data[key].map((value, i) => <button key={i} className={`dp-sensor ${group === key && selected === i ? 'selected' : ''}`} aria-pressed={group === key && selected === i} aria-controls="sensor-history" aria-label={`${channelName(key, i)}: ${value.toFixed(2)} ${config.unit}${stale ? ', stale' : ''}. View history`} onClick={() => inspectSensor(key, i)}><span><i/>{channelName(key, i)}</span><strong>{value.toFixed(2)}<small>{stale ? ' stale' : ''}</small></strong></button>)}</div>
        </section>)}</div>
    </section>;

    const sequence = <section className={`dp-ignition-strip ${stale || aborted ? 'interrupted' : ''}`} aria-label="Ignition sequence">
        <div className="dp-ignition-current"><h2>Ignition sequence</h2><strong role="status">{state}</strong><p>{sequenceDescription}</p></div>
        <ol className="dp-stage-track">{STAGES.map((item, i) => <li key={item.id} aria-current={scenario === item.id ? 'step' : undefined}><span>{String(i + 1).padStart(2, '0')}</span><strong>{item.label}</strong>{scenario === item.id && <small>Current phase</small>}</li>)}</ol>
    </section>;

    const controls = <section className="dp-panel dp-controls" aria-label="Simulated controls">
        <PanelHeader title="Ignition controls" detail="Simulation"/>
        <p className="dp-control-intro">Continuity & command access</p>
        <div className="dp-checks"><div><span>Key continuity</span><Status tone={stale ? 'warning' : 'good'}>{stale ? 'Unknown' : 'Present'}</Status></div><div><span>Burnwire</span><Status tone={stale ? 'warning' : 'good'}>{stale ? 'Unknown' : 'Present'}</Status></div></div>
        <div className="dp-lock-row"><Icon name="lock"/><span>Solenoids <strong>{locked ? 'locked' : 'unlocked'}</strong></span><button disabled={stale || aborted} onClick={() => { setLocked(!locked); log(`Solenoids ${locked ? 'unlocked' : 'locked'} locally`); }}>{locked ? 'Unlock' : 'Lock'}</button></div>
        <div className="dp-solenoids">{valves.map((open, i) => <button key={i} disabled={locked || stale || aborted} aria-label={`Toggle solenoid ${i + 1}, ${open ? 'open' : 'closed'}`} aria-pressed={open} onClick={() => { setValves(valves.map((value, n) => n === i ? !value : value)); log(`S${i + 1} ${open ? 'closed' : 'opened'} locally`); }}><span>S{i + 1}</span><strong>{stale ? 'Stale' : open ? 'Open' : 'Closed'}</strong></button>)}</div>
        <div className="dp-sequence"><label><input type="checkbox" checked={armed} disabled={stale || aborted || sequenceBusy} onChange={event => setArmed(event.target.checked)}/> Enable simulated ignition</label><button className="dp-fire" disabled={!armed || stale || aborted || sequenceBusy} onClick={() => { chooseScenario('burning'); log('Simulated ignition · burning sample loaded'); }}><span>Fire sequence</span><Icon name="arrow"/></button><button className="dp-abort" disabled={stale || aborted} onClick={() => chooseScenario('abort')}><Icon name="stop"/>Abort sequence</button>{aborted && <button className="dp-reset" onClick={() => chooseScenario('standby')}>Reset to standby</button>}</div>
        <p className="dp-footnote">Local preview. Commands never reach hardware.</p>
    </section>;

    const diagram = <section className="dp-panel dp-diagram"><PanelHeader title="Flow overview" detail="Original system schematic"/><FlowDiagram data={data} valves={valves} stale={stale} locked={locked || aborted} sendCommand={command => {
        if (locked || stale || aborted) return;
        const index = Math.floor(command / 2);
        const open = command % 2 === 0;
        setValves(previous => previous.map((value, i) => i === index ? open : value));
        log(`S${index + 1} ${open ? 'opened' : 'closed'} locally`);
    }}/><div className="dp-diagram-footer"><span>4 solenoids</span><span>Original valves, regulators & legends</span></div></section>;
    const trends = <section id="sensor-history" ref={historyRef} tabIndex={-1} className="dp-panel dp-trends" aria-label="Selected sensor history"><PanelHeader title={design === 'analysis' ? 'Signal workspace' : 'Sensor history'}><div className="dp-range" aria-label="History window">{[10, 60].map(seconds => <button key={seconds} aria-pressed={windowSeconds === seconds} onClick={() => setWindowSeconds(seconds)}>{seconds}s</button>)}</div></PanelHeader><div className="dp-chart-label"><span><i/>{channelName(group, selected)} <span className="dp-muted">/ {GROUPS[group].label}</span></span><strong>{data[group][selected].toFixed(2)} <small>{GROUPS[group].unit}</small></strong></div><Plot group={group} index={selected} data={data} windowSeconds={windowSeconds}/>{design === 'analysis' && <div className="dp-secondary-chart"><div className="dp-chart-label"><span><i/>LC-01 <span className="dp-muted">/ Thrust reference</span></span><strong>{data.thrusts[0].toFixed(2)} <small>raw</small></strong></div><Plot group="thrusts" index={0} data={data} windowSeconds={windowSeconds} secondary/></div>}<p className="dp-footnote">Generated sample history · {stale ? 'last-known readings' : 'select a channel to compare'}</p></section>;
    const attitude = <section className="dp-panel dp-attitude"><PanelHeader title="Orientation" detail="Euler angles"/><div className="dp-attitude-content"><div className="dp-attitude-dial" aria-hidden="true"><span>N</span><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="37"/><path d="M50 8v11m0 62v11M8 50h11m62 0h11"/><path className="dp-direction" d="m50 28 10 36-10-6-10 6z"/></svg></div><dl>{LABELS.map((label, i) => <div key={label}><dt>{label}</dt><dd>{data.acc[i].toFixed(1)}<small>°</small></dd></div>)}</dl></div></section>;
    const activity = <section className="dp-panel dp-activity"><PanelHeader title="Activity" detail="Local events"/><ol aria-live="polite">{events.slice(0, 3).map((event, i) => <li key={`${event.time}-${i}`}><time>{event.time}</time><span>{event.message}</span></li>)}</ol></section>;

    return <div className={`dp-root dp-${design}`}>
        <div className="dp-design-bar"><div className="dp-design-label"><span className="dp-alpha-mark">α</span><span>Design study <small>Alpha Ground</small></span></div><nav aria-label="Design options">{Object.entries(DESIGNS).map(([key, value], i) => <button key={key} aria-pressed={key === design} onClick={() => chooseDesign(key)}><small>0{i + 1}</small>{value.name}</button>)}</nav><a href="./">Live Console <span aria-hidden="true">↗</span></a></div>
        <div className="dp-concept"><div><h1>{concept.title}</h1><p>{concept.description}</p></div><label className="dp-scenario">Sample scenario<select value={scenario} onChange={event => chooseScenario(event.target.value)}>{STAGES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="disconnected">Disconnected</option><option value="abort">Abort</option></select></label></div>
        <main className="dp-station">
            <header className="dp-station-header"><div className="dp-brand"><span className="dp-brand-symbol">α</span><strong>ALPHA<span>Ground station</span></strong></div><div className="dp-session"><span>Static fire</span><span className="dp-muted">/</span><strong>Test stand 01</strong></div><a className="dp-sensor-jump" href="#all-sensors">All sensors <span>20 ↓</span></a><div className="dp-link-state"><Status tone={stale ? 'warning' : 'good'}>{stale ? 'Link unavailable' : 'Sample telemetry'}</Status><span className="dp-preview-badge">PREVIEW</span></div></header>
            <div className={`dp-state-banner ${stale || aborted ? 'warning' : ''}`}><span><Icon name={stale ? 'signal' : 'check'}/>{stale ? 'Connection lost. All values are last-known samples.' : aborted ? 'Sequence aborted. Reset to return to standby.' : burning ? 'Burning sample loaded. All activity is simulated.' : `${state} sample loaded. All activity is simulated.`}</span><span className="dp-banner-note">No hardware connection</span></div>
            {sequence}
            <div className="dp-workspace">{diagram}{controls}{channels}{trends}{attitude}{activity}</div>
            <footer className="dp-station-footer"><span><i/>Design preview · synthetic data</span><span>* Native units retained; pressure, temperature & thrust units need verification.</span></footer>
        </main>
        <div className="dp-design-note"><strong>{concept.name}</strong><span>{design === 'console' ? 'Best all-round direction. Familiar layout, calmer hierarchy.' : design === 'field' ? 'Best for outdoor test days. More contrast and larger touch targets.' : 'For troubleshooting. Flow first, with a second reference plot below.'}</span><a href="./" style={{ color: 'var(--accent)' }}>Live Basic / Graphical interface ↗</a><span>Alpha Ground / Interface explorations</span></div>
    </div>;
}
