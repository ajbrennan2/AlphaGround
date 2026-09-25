import { useCallback, useEffect, useRef, useState } from 'react';
import { DISPLAY_INTERVAL_MS } from './telemetry';
import { connectionUrl } from './connectionSettings';

const webTest = import.meta.env.MODE === 'web-test';
const defaultEndpoint = webTest
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/mock/data`
    : import.meta.env.VITE_WS_URL ?? 'ws://10.24.132.76:3333/data';

function initialSettings() {
    if (!webTest) {
        try {
            const saved = JSON.parse(localStorage.getItem('alpha-connection'));
            if (saved) { connectionUrl(saved); return saved; }
        } catch { /* An invalid saved setting falls back to the configured endpoint. */ }
    }
    return { endpoint: defaultEndpoint, mode: 'network', serialPort: '' };
}

export function useTelemetryConnection(store) {
    const socket = useRef(null);
    const stop = useRef(() => {});
    const [settings, setSettings] = useState(initialSettings);
    const [session, setSession] = useState({ enabled: true, revision: 0 });
    const [connection, setConnection] = useState('Connecting');
    const [fresh, setFresh] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!session.enabled) return;
        let disposed = false;
        let retryTimer;
        let retryDelay = 250;
        let lastFrameAt = null;
        let isFresh = false;
        let rejected = false;
        function updateFresh(next) {
            if (next !== isFresh) { isFresh = next; setFresh(next); }
        }
        const url = webTest ? defaultEndpoint : connectionUrl(settings);
        function open() {
            if (disposed) return;
            let ws;
            try { ws = new WebSocket(url); }
            catch (issue) {
                setError(`Could not open connection: ${issue.message}`);
                setConnection('Disconnected');
                return;
            }
            socket.current = ws;
            ws.onopen = () => {
                retryDelay = 250;
                lastFrameAt = null;
                updateFresh(false);
                setConnection('Connected');
            };
            ws.onmessage = event => {
                try {
                    const frame = JSON.parse(event.data);
                    if (frame.connection_error) {
                        rejected = true;
                        setError(String(frame.connection_error));
                        ws.close();
                    } else if (store.ingest(frame)) {
                        lastFrameAt = performance.now();
                        updateFresh(true);
                    }
                } catch { /* Malformed telemetry must not take down the display. */ }
            };
            ws.onerror = () => ws.close();
            ws.onclose = () => {
                if (disposed) return;
                lastFrameAt = null;
                updateFresh(false);
                setConnection(rejected ? 'Disconnected' : 'Disconnected — reconnecting');
                if (!rejected) {
                    retryTimer = setTimeout(open, retryDelay);
                    retryDelay = Math.min(retryDelay * 2, 5000);
                }
            };
        }
        open();
        const publish = () => {
            if (lastFrameAt !== null && performance.now() - lastFrameAt > 2000) updateFresh(false);
            if (!document.hidden) store.publish();
        };
        const timer = setInterval(publish, DISPLAY_INTERVAL_MS);
        document.addEventListener('visibilitychange', publish);
        const cleanup = () => {
            disposed = true;
            clearInterval(timer);
            clearTimeout(retryTimer);
            document.removeEventListener('visibilitychange', publish);
            const ws = socket.current;
            if (ws) {
                ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
                ws.close();
            }
            socket.current = null;
        };
        stop.current = cleanup;
        return cleanup;
    }, [store, settings, session]);

    const connect = useCallback(next => {
        connectionUrl(next);
        stop.current();
        store.reset();
        setFresh(false);
        setError('');
        setConnection('Connecting');
        setSettings(next);
        if (!webTest) {
            try { localStorage.setItem('alpha-connection', JSON.stringify(next)); } catch { /* Storage is optional. */ }
        }
        setSession(previous => ({ enabled: true, revision: previous.revision + 1 }));
    }, [store]);

    const disconnect = useCallback(() => {
        stop.current();
        setFresh(false);
        setConnection('Disconnected');
        setError('');
        setSession(previous => ({ ...previous, enabled: false }));
    }, []);

    const send = useCallback(command => {
        const ws = socket.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        try { ws.send(JSON.stringify({ command })); return true; }
        catch { return false; }
    }, []);

    return { send, connection, fresh, settings, connect, disconnect, error, webTest, sessionId: session.revision };
}
