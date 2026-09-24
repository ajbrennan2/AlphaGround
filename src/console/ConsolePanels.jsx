import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useTelemetry, useHistory } from '../useTelemetry';
import { GROUPS, STAGES, channelName, reading } from './presentation';
import { COMMANDS, solenoidCommand } from './commandPolicy';
import { buildHistorySeries, HISTORY_WINDOWS } from '../history';

const Datachart = lazy(() => import('../Datachart'));
const ThreeScene = lazy(() => import('../ThreeScene'));

export function PanelHeader({ title, detail, children }) {
    return <div className="dp-panel-head"><h2>{title}</h2>{detail && <span>{detail}</span>}{children}</div>;
}
export function Status({ children, tone = 'good' }) {
    return <span className={`dp-status ${tone}`}><i />{children}</span>;
}

const IgnitionStatus = memo(function IgnitionStatus({ store, available }) {
    const state = useTelemetry(store, 'state');
    const going = useTelemetry(store, 'going');
    const stage = STAGES[state];
    const label = !available || state === null ? 'Unknown' : state === 5 ? 'Aborted' : stage.label;
    return <div className={`console-ignition-status ${!available ? 'unavailable' : state === 5 ? 'aborted' : ''}`} aria-label="Ignition status">
        <span>Ignition</span>
        <strong role="status">{label}</strong>
        <span className="console-going" title="Board sequence flag">{!available || going === null ? 'Flag unknown' : going ? 'Active' : 'Inactive'}</span>
    </div>;
});

export const SensorGroup = memo(function SensorGroup({ store, group, selected, onSelect, stale }) {
    const values = useTelemetry(store, group);
    const config = GROUPS[group];
    return <section className={`dp-channel-group dp-group-${group}`} aria-labelledby={`heading-${group}`}>
        <div className="dp-table-heading"><h3 id={`heading-${group}`}>{config.label} <small>{config.count}</small></h3><span title={config.unit === 'raw' ? 'Native values; physical units unverified' : undefined}>{config.unit === 'raw' ? 'Raw' : '°'}</span></div>
        <div className="dp-sensor-list">{values.map((value, index) => <button key={index} className={`dp-sensor ${selected?.group === group && selected.index === index ? 'selected' : ''}`} aria-pressed={selected?.group === group && selected.index === index} aria-controls="sensor-history" onClick={() => onSelect(group, index)} aria-label={`${channelName(group, index)}: ${reading(value)}${stale ? ', stale or unavailable' : ''}. View history`}><span><i />{channelName(group, index)}</span><strong>{reading(value)}{stale && Number.isFinite(value) && <small> stale</small>}</strong></button>)}</div>
    </section>;
});

function Continuity({ label, value, stale }) {
    const unknown = stale || value === null;
    return <div><span>{label}</span><Status tone={unknown ? 'warning' : value ? 'good' : 'danger'}>{unknown ? 'Unknown' : value ? 'Present' : 'Broken'}</Status></div>;
}

function IgnitionActions({ available, transportAvailable, state, sendCommand }) {
    const [enabled, setEnabled] = useState(false);
    const [sent, setSent] = useState(false);
    function fire() {
        // Consume the local enable step even if transport fails; never retry automatically.
        const success = sendCommand(COMMANDS.FIRE, enabled);
        setEnabled(false);
        if (success) setSent(true);
    }
    return <div className="dp-sequence">
        <label><input type="checkbox" checked={enabled} disabled={!available || state !== 0} onChange={event => { setEnabled(event.target.checked); if (event.target.checked) setSent(false); }} />Enable ignition</label>
        <button className="dp-fire" disabled={!available || state !== 0 || !enabled || sent} onClick={fire}><span>{sent ? 'Fire sent · awaiting board' : 'Fire'}</span><span aria-hidden="true">→</span></button>
        <button className="dp-abort" disabled={!transportAvailable} onClick={() => sendCommand(COMMANDS.ABORT)}>Abort</button>
        {state === 5 && <button className="dp-reset" disabled={!available} onClick={() => sendCommand(COMMANDS.RESET)}>Reset to standby</button>}
    </div>;
}

export const Controls = memo(function Controls({ store, connectionStatus, available, transportAvailable, locked, setLocked, sendCommand }) {
    const state = useTelemetry(store, 'state');
    const keys = useTelemetry(store, 'keys');
    const burn = useTelemetry(store, 'burn');
    const solenoids = useTelemetry(store, 'solenoids');
    const [unlocking, setUnlocking] = useState(false);
    const [phrase, setPhrase] = useState('');
    const [error, setError] = useState('');
    function unlock(event) {
        event.preventDefault();
        if (phrase.trim().toLowerCase() !== 'unlock') { setError('Type UNLOCK to enable solenoid commands.'); return; }
        if (!available) return;
        setLocked(false); setUnlocking(false); setPhrase(''); setError('');
    }
    return <section className="dp-panel dp-controls" aria-label="Ignition controls">
        <IgnitionStatus store={store} available={available} />
        <PanelHeader title="Controls" />
        <div className="dp-checks"><Continuity label="Key continuity" value={keys[0]} stale={!available} /><Continuity label="Burnwire" value={burn[0]} stale={!available} /></div>
        <div className="console-valve-controls">
            <div className="dp-lock-row"><span>Solenoids <strong>{locked ? 'Locked' : 'Unlocked'}</strong></span><button disabled={!available} onClick={() => { if (!locked) setLocked(true); else setUnlocking(!unlocking); }}>{locked ? unlocking ? 'Cancel' : 'Unlock' : 'Lock'}</button></div>
            {unlocking && <form className="console-unlock" onSubmit={unlock}><label htmlFor="unlock-phrase">Type UNLOCK to enable</label><div><input id="unlock-phrase" value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? 'unlock-error' : undefined} /><button disabled={!available} type="submit">Unlock</button></div>{error && <p id="unlock-error" role="alert">{error}</p>}</form>}
            <div className="dp-solenoids">{solenoids.map((value, index) => <button key={index} disabled={locked || !available || value === null} aria-pressed={value === 1} title={`Shortcut: ${index + 1}`} aria-label={`Toggle solenoid ${index + 1}, ${value === null ? 'unknown' : value ? 'open' : 'closed'}`} onClick={() => sendCommand(solenoidCommand(index, store.getLatest().solenoids[index]))}><span>S{index + 1}</span><strong>{!available ? 'Unknown' : value === null ? 'Unknown' : value ? 'Open' : 'Closed'}</strong></button>)}</div>
        </div>
        <IgnitionActions key={`${available}:${state}`} available={available} transportAvailable={transportAvailable} state={state} sendCommand={sendCommand} />
        <div className="console-control-connection" role="status"><Status tone={available ? 'good' : 'warning'}>{connectionStatus}</Status>{!available && <span className="console-stale-label">Readings stale / unavailable</span>}</div>
    </section>;
});

function SelectedHistory({ store, selected, stale, windowSeconds }) {
    const history = useHistory(store, selected.group, selected.index);
    const data = useMemo(() => buildHistorySeries(history, windowSeconds), [history, windowSeconds]);
    const latest = data.at(-1);
    return <><div className="dp-chart-label"><span>{channelName(selected.group, selected.index)} <span className="dp-muted">/ {GROUPS[selected.group].label}</span></span><div className="console-history-values"><span className="console-current-value"><small>Current</small><strong>{reading(latest?.value)} <small>{GROUPS[selected.group].unit}</small></strong></span><span className="console-average-value"><small>1s avg</small><strong>{reading(latest?.average)} <small>{GROUPS[selected.group].unit}</small></strong></span></div></div>
        {history.length ? <Suspense fallback={<div className="console-history-empty" role="status">Loading history…</div>}><Datachart data={data} windowSeconds={windowSeconds} /></Suspense> : <div className="console-history-empty">Waiting for samples…</div>}
        {stale && <p className="dp-footnote">Stale / unavailable</p>}</>;
}

export function SensorHistory({ store, selected, stale, historyRef, onClose }) {
    const [windowSeconds, setWindowSeconds] = useState(5);
    return <section id="sensor-history" ref={historyRef} tabIndex={-1} className="dp-panel dp-trends" aria-label="Selected sensor history"><PanelHeader title="History"><div className="dp-range" role="group" aria-label="History time window">{HISTORY_WINDOWS.map(seconds => <button key={seconds} aria-pressed={windowSeconds === seconds} onClick={() => setWindowSeconds(seconds)}>{seconds}s</button>)}</div>{selected && <button className="console-text-button console-close-history" onClick={onClose}>Close</button>}</PanelHeader>{selected ? <SelectedHistory store={store} selected={selected} stale={stale} windowSeconds={windowSeconds} /> : <div className="console-history-empty">Select a sensor to view history.</div>}</section>;
}

export const Attitude = memo(function Attitude({ store, stale }) {
    const orientation = useTelemetry(store, 'acc');
    const unknown = !orientation.every(Number.isFinite);
    return <section className="dp-panel dp-attitude console-rocket" aria-label="Rocket orientation"><div className="console-model"><Suspense fallback={<p className="dp-footnote">Loading rocket…</p>}><ThreeScene store={store} /></Suspense></div>{(stale || unknown) && <span className="console-rocket-status">{unknown ? 'Orientation unavailable' : 'Orientation stale'}</span>}</section>;
});
