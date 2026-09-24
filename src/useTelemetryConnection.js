import { useCallback, useEffect, useRef, useState } from "react";
import { DISPLAY_INTERVAL_MS } from "./telemetry";

export function useTelemetryConnection(store) {
    const socket = useRef(null);
    const [connection, setConnection] = useState("Connecting");
    const [fresh, setFresh] = useState(false);

    useEffect(() => {
        let disposed = false;
        let retryTimer;
        let retryDelay = 250;
        let lastFrameAt = null;
        let isFresh = false;
        function updateFresh(next) {
            if (next !== isFresh) { isFresh = next; setFresh(next); }
        }
        const url = import.meta.env.VITE_WS_URL ?? "ws://10.24.132.76:3333/data";

        function connect() {
            if (disposed) return;
            const ws = new WebSocket(url);
            socket.current = ws;
            ws.onopen = () => {
                retryDelay = 250;
                lastFrameAt = null;
                updateFresh(false);
                setConnection("Connected");
            };
            ws.onmessage = event => {
                try {
                    if (store.ingest(JSON.parse(event.data))) {
                        lastFrameAt = performance.now();
                        updateFresh(true);
                    }
                } catch {
                    // Malformed telemetry must not take down the live display.
                }
            };
            ws.onerror = () => ws.close();
            ws.onclose = () => {
                if (disposed) return;
                lastFrameAt = null;
                updateFresh(false);
                setConnection("Disconnected — reconnecting");
                retryTimer = setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 5000);
            };
        }

        connect();
        // Acquisition continues while hidden, but buffers stay bounded and the
        // UI only catches up once on return. Commands are never replayed.
        const publish = () => {
            if (lastFrameAt !== null && performance.now() - lastFrameAt > 2000) updateFresh(false);
            if (!document.hidden) store.publish();
        };
        const timer = setInterval(publish, DISPLAY_INTERVAL_MS);
        document.addEventListener("visibilitychange", publish);
        return () => {
            disposed = true;
            clearInterval(timer);
            clearTimeout(retryTimer);
            document.removeEventListener("visibilitychange", publish);
            const ws = socket.current;
            if (ws) {
                ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
                ws.close();
            }
            socket.current = null;
        };
    }, [store]);

    const send = useCallback(command => {
        const ws = socket.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.warn("WebSocket not open; command was not sent");
            return false;
        }
        try {
            ws.send(JSON.stringify({ command }));
            return true;
        } catch {
            return false;
        }
    }, []);

    return { send, connection, fresh };
}
