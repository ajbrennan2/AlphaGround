import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Plumbing from './Plumbing';
import GraphicalTelemetry from './console/GraphicalTelemetry';
import { createTelemetryStore } from './telemetry';
import { useTelemetry } from './useTelemetry';
import { useTelemetryConnection } from './useTelemetryConnection';
import { Attitude, ConnectionPanel, ConsoleHeader, Controls, IgnitionStatus, PanelHeader, SensorGroup, SensorHistory } from './console/ConsolePanels';
import { commandBlockReason, shortcutSolenoid, solenoidCommand } from './console/commandPolicy';
import { GROUPS } from './console/presentation';
import { resolveValveRequests, waitingValveRequests, VALVE_RESPONSE_DELAY_MS } from './console/valveRequests';
import './App.css';

function ConsoleSession({ graphical, setGraphical, store, send, connection, fresh, serialConnected, available, transportAvailable, selected, setSelected, events, setEvents, connectionControls }) {
    const [lockState, setLockState] = useState({ available, locked: true });
    // Reset only command access on link changes; keep the chart and WebGL canvas mounted.
    if (lockState.available !== available) setLockState({ available, locked: true });
    const locked = lockState.available !== available || lockState.locked;
    const [requests, setRequests] = useState({});
    const requestsRef = useRef({});
    const solenoids = useTelemetry(store, 'solenoids');
    const [requestClock, setRequestClock] = useState(0);
    const waitingRequests = useMemo(() => waitingValveRequests(requests, solenoids, available, requestClock), [requests, solenoids, available, requestClock]);
    useEffect(() => {
        const deadlines = Object.values(requests).map(request => request.requestedAt + VALVE_RESPONSE_DELAY_MS).filter(deadline => deadline > requestClock);
        if (!deadlines.length) return;
        // Wake even when telemetry stops. Replaced/resolved requests cancel this timer.
        const timer = setTimeout(() => setRequestClock(performance.now()), Math.max(0, Math.min(...deadlines) - performance.now()));
        return () => clearTimeout(timer);
    }, [requests, requestClock]);
    const historyRef = useRef(null);
    const [historyMode, setHistoryMode] = useState('history');
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
        const canSend = connection === 'Connected' && fresh && latest.serial_connected !== false;
        const success = command < 8 ? canSend && send(command) : send(command);
        if (command < 8) {
            const index = Math.floor(command / 2);
            const next = { ...requestsRef.current, [index]: { value: command % 2 ? 0 : 1, sent: success, requestedAt: performance.now(), afterFrame: latest.frameId ?? 0 } };
            requestsRef.current = next;
            setRequests(next);
        }
        const name = command < 8 ? `S${Math.floor(command / 2) + 1} ${command % 2 ? 'close' : 'open'}` : ['FIRE', 'RESET', 'ABORT'][command - 8];
        report(command < 8
            ? success ? `${name} sent` : `${name} not sent · disconnected`
            : success ? `${name} sent · awaiting board telemetry` : `${name} not sent · transport unavailable`);
        return success;
    }, [store, connection, fresh, locked, send, report]);

    useEffect(() => store.subscribe('frameId', () => {
        const previous = requestsRef.current;
        const next = resolveValveRequests(previous, store.getLatest());
        if (next !== previous) { requestsRef.current = next; setRequests(next); }
    }), [store]);

    const toggleSolenoid = useCallback(index => {
        const value = requestsRef.current[index]?.value ?? store.getLatest().solenoids[index];
        sendCommand(solenoidCommand(index, value));
    }, [store, sendCommand]);

    useEffect(() => {
        const handler = event => {
            const index = shortcutSolenoid(event);
            if (index === null) return;
            event.preventDefault();
            toggleSolenoid(index);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [toggleSolenoid]);

    const selectSensor = useCallback((group, index) => {
        setSelected({ group, index });
        setHistoryMode('history');
        historyRef.current?.focus({ preventScroll: true });
    }, [setSelected]);
    const changeLock = useCallback(next => { setLockState({ available, locked: next }); report(`Solenoid commands ${next ? 'locked' : 'unlocked'}`); }, [available, report]);
    const status = connection !== 'Connected' ? connection : serialConnected === false ? 'Serial disconnected' : !fresh ? 'Waiting for telemetry' : 'Telemetry connected';

    const header = <ConsoleHeader store={store} available={available} connectionStatus={status} connectionControls={connectionControls} />;

    return <div className={`dp-root dp-console console-app${graphical ? ' console-graphical' : ''}`}><main className="dp-station">
        {!graphical && header}
        <div className="dp-workspace">
            {graphical && <header className="console-header"><IgnitionStatus store={store} available={available} /></header>}
            <Controls key={available ? 'available' : 'unavailable'} graphical={graphical} store={store} available={available} transportAvailable={transportAvailable} locked={locked} setLocked={changeLock} sendCommand={sendCommand} toggleSolenoid={toggleSolenoid} requests={waitingRequests} />
            {graphical && <ConnectionPanel available={available} connectionStatus={status} connectionControls={connectionControls} />}
            <section id="flow-diagram" className="dp-panel dp-diagram" aria-label="Flow diagram">
                <div className="console-schematic-heading">{graphical ? <button className="console-graphical-button" onClick={() => setGraphical(false)}>Default view <span aria-hidden="true">↗</span></button> : <div className="console-schematic-title"><strong>ALPHA<span> / Ground control</span></strong><h1>Propulsion schematic</h1></div>}</div>
                <div className="console-flow-scroll dp-original-flow"><Plumbing attitude={!graphical && <Attitude store={store} stale={!available} />} store={store} sendCommand={sendCommand} toggleSolenoid={toggleSolenoid} requests={waitingRequests} controlsDisabled={locked} stale={!available} /></div>
            </section>
            {graphical ? <GraphicalTelemetry store={store} stale={!available} events={events} /> : <aside className="console-data-rail" aria-label="Sensor telemetry">
                <section id="all-sensors" className="dp-panel dp-channels" aria-label="All sensor readings"><PanelHeader title="Live telemetry" detail={available ? '20 channels' : '20 channels · stale'} /><div className="dp-channel-groups">{Object.keys(GROUPS).map(group => <SensorGroup key={group} store={store} group={group} selected={selected} onSelect={selectSensor} stale={!available} />)}</div></section>
                <SensorHistory store={store} selected={selected} stale={!available} historyRef={historyRef} onClose={() => setSelected(null)} mode={historyMode} onModeChange={setHistoryMode} events={events} onGraphicalView={() => setGraphical(true)} />
            </aside>}
        </div>
    </main></div>;

}

export default function App() {
    const [store] = useState(createTelemetryStore);
    const [graphical, setGraphical] = useState(() => {
        try { return localStorage.getItem('alpha-ground-interface') === 'graphical'; }
        catch { return false; }
    });
    useEffect(() => {
        try { localStorage.setItem('alpha-ground-interface', graphical ? 'graphical' : 'basic'); }
        catch { /* The view remains usable when storage is unavailable. */ }
    }, [graphical]);
    const [selected, setSelected] = useState(null);
    const [events, setEvents] = useState([]);
    const connectionControls = useTelemetryConnection(store);
    const { send, connection, fresh, sessionId } = connectionControls;
    const serialConnected = useTelemetry(store, 'serial_connected');
    const transportAvailable = connection === 'Connected' && serialConnected !== false;
    const available = transportAvailable && fresh;
    // A loss of usable telemetry resets local command locks and ignition enable.
    // Acquisition buffers remain in the parent store; no commands are replayed.
    return <ConsoleSession graphical={graphical} setGraphical={setGraphical} key={sessionId} connectionControls={connectionControls} selected={selected} setSelected={setSelected} events={events} setEvents={setEvents} store={store} send={send} connection={connection} fresh={fresh} serialConnected={serialConnected} available={available} transportAvailable={transportAvailable} />;
}
