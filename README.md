# Alpha Peripheral Board GroundStation Software

React + Vite ground station with Electron.

## Running

```bash
npm install
npm run dev
```

The telemetry endpoint defaults to `ws://10.24.132.76:3333/data`.
Copy `.env.example` to `.env.local` to override `VITE_WS_URL`.
Use `npm run build:react` to build the web UI or `npm run build` to package Electron.

## Console

The original plumbing SVG remains the main view, with board-reported ignition
status above the controls. All 20 sensor channels are available below the diagram.
Select a reading for its history; the rocket continuously shows orientation.

History offers 3s, 5s, and 10s windows, with a trailing one-second average line
and value. Missing readings leave gaps in the raw line; the average continues
while valid samples remain in its window. Empty windows and long outages break
the average. Zero remains a valid reading.

Telemetry uses bounded 1,440-sample buffers, live display updates at roughly
30 Hz, and history updates at most 10 Hz. Closed histories release their snapshots;
hidden windows skip display updates. The rocket renders only when needed.

Solenoid controls require typing `UNLOCK`; buttons, the SVG, and keys 1–4 share
the same command checks. Fire requires standby and a separate ignition enable,
which is consumed on each send. Reset is available in the abort state.
The activity log records sends, not hardware acknowledgments.

Socket loss, two seconds without valid telemetry, or reported serial failure
marks readings stale and resets local control enables. Abort remains available
on an open transport during stale telemetry unless serial is reported disconnected.
Reconnection never replays commands.

## Telemetry contract

Each WebSocket message is a JSON object containing arrays: `temps` (4),
`pressures` (12), `thrusts` (1), `acc` (3), `solenoids` (4), `keys` (1), and
`burn` (1), plus `going` and `state`. Optional `time` is in Unix seconds;
`serial_connected` reports serial availability.

`state` indexes Standby, Fire received, Ignite, Burning, Cooldown, and Abort.
Commands retain the existing mapping: `{"command": n}`, with 0–7 for solenoid
open/close pairs, 8 for Fire, 9 for Reset, and 10 for Abort.

Pressure, temperature, and thrust retain native units. Channel labels are array
indices: PT-01 is `pressures[0]`, TC-01 is `temps[0]`, and LC-01 is `thrusts[0]`.
Orientation preserves the existing yaw/pitch/roll interpretation and display axes;
physical units and axis calibration still require hardware verification.
