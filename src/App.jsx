import { useCallback, useEffect, useRef, useState } from 'react';
import Plumbing from './Plumbing';
import { createTelemetryStore } from './telemetry';
import { useTelemetry } from './useTelemetry';
import { useTelemetryConnection } from './useTelemetryConnection';
import { Attitude, Controls, PanelHeader, SensorGroup, SensorHistory } from './console/ConsolePanels';
import { commandBlockReason, shortcutSolenoid, solenoidCommand } from './console/commandPolicy';
import { GROUPS } from './console/presentation';
import './App.css';

function ConsoleSession({ store, send, connection, fresh, serialConnected, available, transportAvailable, selected, setSelected, events, setEvents }) {
    const [lockState, setLockState] = useState({ available, locked: true });
    // Reset only command access on link changes; keep the chart and WebGL canvas mounted.
    if (lockState.available !== available) setLockState({ available, locked: true });
    const locked = !available || lockState.available !== available || lockState.locked;
    const historyRef = useRef(null);
    const report = useCallback(message => {
        setEvents(previous => [{ time: new Date().toLocaleTimeString('en-GB', { hour12: false }), message }, ...previous].slice(0, 20));
    }, [setEvents]);
    const sendCommand = useCallback((command, fireEnabled = false) => {
        const latest = store.getLatest();
        const blocked = commandBlockReason(command, {
            connected: connection === 'Connected', fresh, serialConnected: latest.serial_connected,
            locked, fireEnabled, state: latest.state, solenoids: latest.solenoids,
        });
        if (blocked) { report(blocked); return false; }
        const success = send(command);
        const name = command < 8 ? `S${Math.floor(command / 2) + 1} ${command % 2 ? 'close' : 'open'}` : ['FIRE', 'RESET', 'ABORT'][command - 8];
        report(success ? `${name} sent · awaiting board telemetry` : `${name} not sent · transport unavailable`);
        return success;
    }, [store, connection, fresh, locked, send, report]);

    useEffect(() => {
        const handler = event => {
            const index = shortcutSolenoid(event);
            if (index === null) return;
            event.preventDefault();
            sendCommand(solenoidCommand(index, store.getLatest().solenoids[index]));
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [store, sendCommand]);

    const selectSensor = useCallback((group, index) => {
        setSelected({ group, index });
        historyRef.current?.focus({ preventScroll: true });
        historyRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }, [setSelected]);
    const changeLock = useCallback(next => { setLockState({ available, locked: next }); report(`Solenoid commands ${next ? 'locked' : 'unlocked'}`); }, [available, report]);
    const status = connection !== 'Connected' ? connection : serialConnected === false ? 'Serial disconnected' : !fresh ? 'Waiting for telemetry' : 'Telemetry connected';

    return <div className="dp-root dp-console console-app"><main className="dp-station">
        <div className="dp-workspace">
            <section id="flow-diagram" className="dp-panel dp-diagram" aria-label="Flow diagram"><div className="console-flow-scroll dp-original-flow"><Plumbing store={store} sendCommand={sendCommand} controlsDisabled={locked || !available} stale={!available} /></div></section>
            <Controls key={available ? 'available' : 'unavailable'} store={store} connectionStatus={status} available={available} transportAvailable={transportAvailable} locked={locked} setLocked={changeLock} sendCommand={sendCommand} />
            <section id="all-sensors" className="dp-panel dp-channels" aria-label="All sensor readings"><div className="dp-channel-groups">{Object.keys(GROUPS).map(group => <SensorGroup key={group} store={store} group={group} selected={selected} onSelect={selectSensor} stale={!available} />)}</div></section>
            <SensorHistory store={store} selected={selected} stale={!available} historyRef={historyRef} onClose={() => setSelected(null)} />
            <Attitude store={store} stale={!available} />
            <section className="dp-panel dp-activity"><PanelHeader title="Activity" /><p className="console-sr-only" role="status">{events[0]?.message ?? 'No commands sent.'}</p>{!events.length && <p className="dp-footnote">No commands sent.</p>}<ol>{events.slice(0, 5).map((event, index) => <li key={`${event.time}-${index}`}><time>{event.time}</time><span>{event.message}</span></li>)}</ol></section>
        </div>
    </main></div>;
}

export default function App() {
    const [store] = useState(createTelemetryStore);
    const [selected, setSelected] = useState(null);
    const [events, setEvents] = useState([]);
    const { send, connection, fresh } = useTelemetryConnection(store);
    const serialConnected = useTelemetry(store, 'serial_connected');
    const transportAvailable = connection === 'Connected' && serialConnected !== false;
    const available = transportAvailable && fresh;
    // A loss of usable telemetry resets local command locks and ignition enable.
    // Acquisition buffers remain in the parent store; no commands are replayed.
    return <ConsoleSession selected={selected} setSelected={setSelected} events={events} setEvents={setEvents} store={store} send={send} connection={connection} fresh={fresh} serialConnected={serialConnected} available={available} transportAvailable={transportAvailable} />;
}
