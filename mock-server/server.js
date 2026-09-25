// Stand-in for the flight computer's telemetry feed.
//
//   ws://localhost:3333/data     what App.jsx connects to
//   http://localhost:3333/       control panel for editing the feed by hand
//
// Run it with `npm run mock`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { COMMANDS, COUNTS, STATES, SCENARIOS, defaultConfig, manualConfig } from "./config.js";

import { applyPatch, validCommand } from "./patch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MOCK_PORT ?? 3333);

let config = process.env.MOCK_MANUAL === "1" ? manualConfig() : defaultConfig();
let frame = null;
const log = []; // most recent commands received from the app, newest first
const walkState = new Map(); // channel key -> current random-walk value
let sequenceTimers = [];

// ---------------------------------------------------------------- generators

function sampleChannel(key, c, t) {
    const amp = Number(c.amp) || 0;
    const value = Number(c.value) || 0;
    const period = Math.max(0.05, Number(c.period) || 1);

    switch (c.mode) {
        case "sine":
            return value + amp * Math.sin((2 * Math.PI * t) / period);
        case "ramp":
            return value + amp * ((t % period) / period);
        case "noise":
            return value + amp * (Math.random() * 2 - 1);
        case "walk": {
            const prev = walkState.has(key) ? walkState.get(key) : value;
            // Drift randomly, but pulled back toward `value` so it never escapes.
            const drift = amp * (Math.random() * 2 - 1) * 0.15;
            const next = prev + drift + (value - prev) * 0.02;
            walkState.set(key, next);
            return next;
        }
        case "fixed":
        default:
            return value;
    }
}

function buildFrame(t) {
    const out = {};
    for (const group of Object.keys(COUNTS)) {
        const channels = config.channels[group] ?? [];
        out[group] = channels.map((c, i) =>
            Number(sampleChannel(`${group}.${i}`, c, t).toFixed(3)),
        );
    }
    return {
        ...out,
        time: Date.now() / 1000,
        serial_connected: config.serialConnected,
        solenoids: config.solenoids.map((v) => (v ? 1 : 0)),
        keys: config.keys.map((v) => (v ? 1 : 0)),
        burn: config.burn.map((v) => (v ? 1 : 0)),
        going: config.going ? 1 : 0,
        state: config.state,
    };
}

// ------------------------------------------------------------ state sequence

function clearSequence() {
    sequenceTimers.forEach(clearTimeout);
    sequenceTimers = [];
}

// FIRE walks STANDBY -> ... -> COOLDOWN -> STANDBY so the UI's state readout
// and burn indicators can be exercised without hand-stepping every stage.
function runFireSequence() {
    clearSequence();
    const steps = [
        [0, 1], // FIRE_RECIEVED
        [900, 2], // IGNITE
        [2200, 3], // BURNING
        [8000, 4], // COOLDOWN
        [12000, 0], // STANDBY
    ];
    for (const [delay, state] of steps) {
        sequenceTimers.push(
            setTimeout(() => {
                config.state = state;
                config.going = state === 2 || state === 3 ? 1 : 0;
                pushPanel();
            }, delay),
        );
    }
}

function handleCommand(command) {
    if (!validCommand(command)) return;
    const name = COMMANDS[command] ?? `UNKNOWN(${command})`;
    log.unshift({ at: Date.now(), command, name });
    log.length = Math.min(log.length, 40);

    if (command >= 0 && command <= 7) {
        config.solenoids[Math.floor(command / 2)] = command % 2 === 0 ? 1 : 0;
    } else if (command === 8) {
        if (config.autoSequence) runFireSequence();
        else config.state = 1;
    } else if (command === 9) {
        clearSequence();
        config.state = 0;
        config.going = 0;
    } else if (command === 10) {
        clearSequence();
        config.state = 5;
        config.going = 0;
    }
    pushPanel();
}

// ------------------------------------------------------------------ plumbing

const server = http.createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/favicon.ico") {
        res.writeHead(204).end();
        return;
    }
    if (url === "/health") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ service: "alpha-mock", manual: process.env.MOCK_MANUAL === "1" }));
        return;
    }
    if (!["/", "/index.html"].includes(url)) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    fs.createReadStream(path.join(__dirname, "panel.html")).pipe(res);
});

const dataClients = new Set();
const panelClients = new Set();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== "/data" && url !== "/control") {
        socket.destroy();
        return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
        const set = url === "/data" ? dataClients : panelClients;
        set.add(ws);
        ws.on("close", () => { set.delete(ws); pushPanel(); });

        if (url === "/data") {
            ws.on("message", (raw) => {
                try {
                    const msg = JSON.parse(raw.toString());
                    if (validCommand(msg.command)) handleCommand(msg.command);
                } catch {
                    /* malformed input does not alter the mock state */
                }
            });
            pushPanel();
        } else {
            ws.on("message", (raw) => {
                try {
                    handlePanelMessage(JSON.parse(raw.toString()), ws);
                } catch {
                    /* ignore */
                }
            });
            send(ws, { type: "hello", config, scenarios: scenarioList(), frame, log, clients: dataClients.size });
        }
    });
});

function scenarioList() {
    return Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label }));
}

function handlePanelMessage(msg, ws) {
    if (msg.type === "patch") {
        const next = applyPatch(config, msg.path, msg.value);
        if (!next) { send(ws, { type: "error", message: "Invalid parameter value." }); return; }
        if (msg.path[0] === "state" || msg.path[0] === "going" || (msg.path[0] === "autoSequence" && !msg.value)) clearSequence();
        if (msg.path[0] === "channels") walkState.delete(`${msg.path[1]}.${msg.path[2]}`);
        config = next;
    } else if (msg.type === "scenario" && Object.hasOwn(SCENARIOS, msg.id)) {
        clearSequence();
        walkState.clear();
        config = SCENARIOS[msg.id].apply();
    } else if (msg.type === "command" && validCommand(msg.command)) {
        handleCommand(msg.command);
    } else {
        send(ws, { type: "error", message: "Unknown bench action." });
        return;
    }
    pushPanel();
}

function send(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function pushPanel() {
    const payload = {
        type: "sync",
        config,
        frame,
        log,
        clients: dataClients.size,
    };
    for (const ws of panelClients) send(ws, payload);
}

// ---------------------------------------------------------------- main loops

const t0 = Date.now();
let tickHandle = null;

function schedule() {
    if (tickHandle) clearInterval(tickHandle);
    const hz = Math.min(120, Math.max(1, Number(config.rate) || 30));
    tickHandle = setInterval(() => {
        if (!config.running) return;
        frame = buildFrame((Date.now() - t0) / 1000);
        const json = JSON.stringify(frame);
        for (const ws of dataClients) if (ws.readyState === ws.OPEN) ws.send(json);
    }, 1000 / hz);
}

let lastRate = config.rate;
setInterval(() => {
    if (config.rate !== lastRate) {
        lastRate = config.rate;
        schedule();
    }
    pushPanel(); // keep the panel's live readout fresh at a calm 10 Hz
}, 100);

schedule();
server.listen(PORT, "127.0.0.1", () => {
    const port = server.address().port;
    console.log(`\n  mock telemetry  ws://localhost:${port}/data`);
    console.log(`  control panel   http://localhost:${port}/\n`);
    console.log(`  states: ${STATES.join(" → ")}\n`);
});
