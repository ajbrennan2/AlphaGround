import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useTelemetry, useHistory } from '../useTelemetry';
import { GROUPS, STAGES, channelName, reading } from './presentation';
import { COMMANDS } from './commandPolicy';
import { buildHistorySeries, HISTORY_WINDOWS } from '../history';

import ConnectionMenu from './ConnectionMenu';
import ControlIcon from './ControlIcon';

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
    return <div className={`console-mission-state ${!available ? 'unavailable' : state === 5 ? 'aborted' : ''}`}>
        <div className="console-ignition-status" aria-label="Ignition status"><span>Ignition sequence</span><strong role="status">{label}</strong><span className="console-going" title="Board sequence flag"><i />{!available || going === null ? 'Sequence unknown' : going ? 'Sequence active' : 'Sequence inactive'}</span></div>
        <ol className="console-phase-track" aria-label="Ignition phases">{STAGES.map((stage, index) => <li key={stage.label} className={available && state === index ? 'current' : ''} aria-current={available && state === index ? 'step' : undefined}><span />{stage.label}</li>)}</ol>
    </div>;
});

export function ConsoleHeader({ store, available, connectionStatus, connectionControls }) {
    return <header className="console-header">
        <IgnitionStatus store={store} available={available} />
        <div className="console-link-panel"><div className="console-control-connection" role="status"><Status tone={available ? 'good' : 'warning'}>{connectionStatus}</Status>{!available && <span className="console-stale-label">Stale / unavailable</span>}</div><ConnectionMenu {...connectionControls} /></div>
    </header>;
}

export const SensorGroup = memo(function SensorGroup({ store, group, selected, onSelect, stale }) {
    const values = useTelemetry(store, group);
    const config = GROUPS[group];
    return <section className={`dp-channel-group dp-group-${group}${stale ? ' stale' : ''}`} aria-labelledby={`heading-${group}`}>
        <div className="dp-table-heading"><h3 id={`heading-${group}`}>{group === 'temps' ? 'Temps' : config.label} <small>{config.count}</small></h3><span title={config.unit === 'raw' ? 'Native values; physical units unverified' : undefined}>{config.unit === 'raw' ? 'Raw' : '°'}</span></div>
        <div className="dp-sensor-list">{values.map((value, index) => <button key={index} className={`dp-sensor ${selected?.group === group && selected.index === index ? 'selected' : ''}`} aria-pressed={selected?.group === group && selected.index === index} aria-controls="sensor-history" onClick={() => onSelect(group, index)} aria-label={`${channelName(group, index)}: ${reading(value)}${stale ? ', stale or unavailable' : ''}. View history`}><span><i />{channelName(group, index)}</span><strong>{reading(value)}</strong></button>)}</div>
    </section>;
});

function Continuity({ label, value, stale, icon }) {
    const unknown = stale || value === null;
    return <div className={`console-continuity ${unknown ? 'unknown' : value ? 'present' : 'broken'}`}><ControlIcon name={icon} /><span>{label}</span><Status tone={unknown ? 'warning' : value ? 'good' : 'danger'}>{unknown ? 'Unknown' : value ? 'Present' : 'Broken'}</Status></div>;
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
    return <div className={`dp-sequence ${enabled ? 'enabled' : ''}`}>
        <label className="console-enable"><input type="checkbox" aria-label="Enable ignition" checked={enabled} disabled={!available || state !== 0} onChange={event => { setEnabled(event.target.checked); if (event.target.checked) setSent(false); }} /><span className="console-enable-switch" aria-hidden="true" /><span>Enable ignition</span><strong>{enabled ? 'Enabled' : 'Disabled'}</strong></label>
        <div className="console-fire-actions"><button className="dp-fire" disabled={!available || state !== 0 || !enabled || sent} onClick={fire}><ControlIcon name="fire" /><span><strong>{sent ? 'Fire sent' : 'Fire'}</strong><small>{sent ? 'Awaiting board' : enabled ? 'Send ignition command' : 'Enable to command'}</small></span></button>
        <button className="dp-abort" disabled={!transportAvailable} onClick={() => sendCommand(COMMANDS.ABORT)}><ControlIcon name="stop" /><span><strong>Abort</strong><small>Stop sequence</small></span></button></div>
        {state === 5 && <button className="dp-reset" disabled={!available} onClick={() => sendCommand(COMMANDS.RESET)}>Reset to standby <span aria-hidden="true">↗</span></button>}
    </div>;

}

export const Controls = memo(function Controls({ store, available, transportAvailable, locked, setLocked, sendCommand, toggleSolenoid, requests = {} }) {
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
        setLocked(false); setUnlocking(false); setPhrase(''); setError('');
    }
    return <section className="dp-panel dp-controls" aria-label="Ignition controls">
        <div className="console-valve-controls">
            <div className="dp-lock-row"><span><ControlIcon name="lock" />Solenoids <strong>{locked ? 'Locked' : 'Unlocked'}</strong></span><button onClick={() => { if (!locked) setLocked(true); else setUnlocking(!unlocking); }}>{locked ? unlocking ? 'Cancel' : 'Unlock' : 'Lock'}</button></div>
            {unlocking && <form className="console-unlock" onSubmit={unlock}><label htmlFor="unlock-phrase">Type UNLOCK to enable</label><div><input id="unlock-phrase" value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? 'unlock-error' : undefined} /><button type="submit">Unlock</button></div>{error && <p id="unlock-error" role="alert">{error}</p>}</form>}
            <div className="dp-solenoids">{solenoids.map((value, index) => {
                const request = requests[index];
                const reported = !available || value === null ? 'Unknown' : value ? 'Open' : 'Closed';
                return <button key={index} disabled={locked} className={request ? 'pending' : ''} aria-pressed={available && value === 1} title={`Shortcut: ${index + 1}. Reported: ${reported}`} aria-label={`Toggle solenoid ${index + 1}, reported ${reported}${request ? `, ${request.value ? 'open' : 'close'} requested` : ''}`} onClick={() => toggleSolenoid(index)}><span>S{index + 1} <kbd>{index + 1}</kbd></span><strong>{request ? `${request.value ? 'Open' : 'Close'} requested` : reported}</strong>{request && <small>Board: {reported === 'Unknown' ? '—' : reported}</small>}</button>;
            })}</div>
            {Object.keys(requests).length > 0 && <p className="console-valve-pending" role="status">{!available ? 'Disconnected · waiting for response.' : Object.values(requests).some(request => !request.sent) ? 'Not sent · select a valve to send a new request.' : 'Waiting for response from board.'} {!available && 'Not queued.'}</p>}

        </div>
        <div className="console-readiness"><PanelHeader title="Continuity" /><div className="dp-checks"><Continuity label="Key" icon="key" value={keys[0]} stale={!available} /><Continuity label="Burnwire" icon="circuit" value={burn[0]} stale={!available} /></div></div>
        <IgnitionActions key={`${available}:${state}`} available={available} transportAvailable={transportAvailable} state={state} sendCommand={sendCommand} />

    </section>;
});

function SelectedHistory({ store, selected, stale, windowSeconds }) {
    const history = useHistory(store, selected.group, selected.index);
    const data = useMemo(() => buildHistorySeries(history, windowSeconds), [history, windowSeconds]);
    const latest = data.at(-1);
    const missing = data.filter(point => point.value === null).length;
    return <><div className="dp-chart-label"><span className="console-selected-channel">{channelName(selected.group, selected.index)} <span className="dp-muted">{GROUPS[selected.group].unit}</span></span><div className="console-history-values"><span className="console-current-value"><small>Current</small><strong>{reading(latest?.value)} <small>{GROUPS[selected.group].unit}</small></strong></span><span className="console-average-value"><small>1s avg</small><strong>{reading(latest?.average)} <small>{GROUPS[selected.group].unit}</small></strong></span></div></div>
        {history.length ? <Suspense fallback={<div className="console-history-empty" role="status">Loading history…</div>}><Datachart data={data} windowSeconds={windowSeconds} /></Suspense> : <div className="console-history-empty">Waiting for samples…</div>}
        {(stale || missing > 0) && <p className="dp-footnote">{stale ? 'Stale readings. ' : ''}{missing > 0 && 'Gaps: missing or invalid telemetry.'}</p>}</>;
}

export function SensorHistory({ store, selected, stale, historyRef, onClose, mode, onModeChange, events }) {
    const [windowSeconds, setWindowSeconds] = useState(5);
    function navigateTabs(event) {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'history' : event.key === 'End' ? 'activity' : mode === 'history' ? 'activity' : 'history';
        onModeChange(next);
        event.currentTarget.querySelector(`#${next}-tab`)?.focus();
    }
    return <section id="sensor-history" ref={historyRef} tabIndex={-1} className="dp-panel dp-trends" aria-label="History and activity">
        <div className="dp-panel-head">
            <div className="console-history-tabs" role="tablist" aria-label="History and activity" onKeyDown={navigateTabs}>
                {['history', 'activity'].map(tab => <button key={tab} id={`${tab}-tab`} role="tab" aria-selected={mode === tab} aria-controls={`${tab}-panel`} tabIndex={mode === tab ? 0 : -1} onClick={() => onModeChange(tab)}>{tab === 'history' ? 'History' : 'Activity'}</button>)}
            </div>
            {mode === 'history' && <><div className="dp-range" role="group" aria-label="History time window">{HISTORY_WINDOWS.map(seconds => <button key={seconds} aria-pressed={windowSeconds === seconds} onClick={() => setWindowSeconds(seconds)}>{seconds}s</button>)}</div>{selected && <button className="console-text-button console-close-history" onClick={onClose}>Close</button>}</>}
        </div>
        <div id="history-panel" className="console-history-panel" role="tabpanel" aria-labelledby="history-tab" tabIndex={0} hidden={mode !== 'history'}>
            {selected ? <SelectedHistory store={store} selected={selected} stale={stale} windowSeconds={windowSeconds} /> : <div className="console-history-empty">Select a sensor to view history.</div>}
        </div>
        <div id="activity-panel" className="console-activity-panel dp-activity" role="tabpanel" aria-labelledby="activity-tab" tabIndex={0} hidden={mode !== 'activity'}>
            {events.length ? <ol>{events.map((event, index) => <li key={`${event.time}-${index}`}><time>{event.time}</time><span>{event.message}</span></li>)}</ol> : <div className="console-history-empty">No commands sent.</div>}
            {import.meta.env.MODE === 'web-test' && <a className="console-bench-link" href="/bench/" target="_blank" rel="noopener noreferrer">Parameters ↗</a>}
        </div>
        <p className="console-sr-only" role="status">{events[0]?.message ?? 'No commands sent.'}</p>
    </section>;
}

export const Attitude = memo(function Attitude({ store, stale }) {
    const orientation = useTelemetry(store, 'acc');
    const unknown = !orientation.every(Number.isFinite);
    return <section className="dp-panel dp-attitude console-rocket" aria-label="Rocket orientation"><div className="console-model"><Suspense fallback={<p className="dp-footnote">Loading rocket…</p>}><ThreeScene store={store} /></Suspense></div><div className="console-rocket-status"><span>Attitude</span><small>{unknown ? 'Unavailable' : stale ? 'Stale' : 'Live'}</small></div></section>;
});
