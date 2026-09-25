# Alpha Peripheral Board GroundStation Software

## Built using React + Vite with Electron

## Running it

```bash
npm install
npm run dev          # Vite + Electron, talking to the real board
```

`npm install` needs one-time approval for Electron's postinstall on npm 11+
(already recorded in `allowScripts` in package.json). If the Electron binary is
missing, `rm -rf node_modules/electron/dist && npm rebuild electron`.

The UI reads its telemetry endpoint from `VITE_WS_URL`, falling back to the
board at `ws://10.24.132.76:3333/data`. Use **Connection…** in the controls panel
to enter an IP address (default port 3333), a complete `ws://` / `wss://` URL, or
a serial bridge address and port. The last selection is saved locally and takes
precedence over this default. **Disconnect** stops the socket and automatic
retries until you choose **Connect** again. Copy `.env.example` to `.env.local`
to change the initial default. Manual reconnects clear readings/history so data
from different endpoints is not mixed.

## Web development testing

```bash
npm run dev:web
```

Open **http://localhost:5174/** for Console, then open
**http://localhost:5174/bench/** in a separate browser or window to edit telemetry.
Console also has a small **Web test · Parameters** link below its controls.
Neither page opens automatically. This mode uses a local mock only, regardless of
`VITE_WS_URL` in `.env.local`, and does not launch Electron or connect to hardware.
The separate port leaves any normal development server on 5173 alone.

All 20 channels start in **fixed** mode, and the ignition state is manually
controlled. Sliders apply immediately; numeric entries apply on Enter or blur.
The bench includes:

- Temperatures TC-01–04, pressures PT-01–12, thrust LC-01, and yaw/pitch/roll.
- Ignition state, sequence flag, four solenoids, and key/burnwire continuity.
- A serial-connected toggle and Pause/Resume for testing stale readings.
- Optional sine/ramp/noise/walk generators, rate control, and scenario presets.
- A command log; Console commands affect the mock, never physical hardware.

Enable **auto-run FIRE sequence** to exercise automatic phase transitions. Manual
state changes cancel that sequence; editing a sensor value does not. Each panel
sends only its edited field, so simultaneous panels preserve unrelated changes.
Scenario buttons reset the full configuration; **Manual / fixed** restores the
steady starting values. Physical units remain unverified, matching Console.

The mock listens on localhost port 3333; the web test server proxies it so both
pages share port 5174. Both processes stop together with Ctrl+C, or if one exits.
Occupied ports fail visibly instead of silently moving to a different app URL.

Other entry points remain available:

```bash
npm run dev:mock     # animated mock + Vite + Electron on 5173
npm run mock         # mock alone; parameter panel at http://localhost:3333/
```

### Contract

One JSON frame per message, 30 Hz by default:

```json
{
  "temps": [4], "pressures": [12], "thrusts": [1], "acc": [3],
  "solenoids": [4], "keys": [1], "burn": [1],
  "going": 0, "state": 0
}
```

`acc` is BNO055 Euler degrees (yaw, pitch, roll). `state` indexes
`STANDBY, FIRE_RECIEVED, IGNITE, BURNING, COOLDOWN, ABORT`. The app sends
`{"command": n}` back, `n` being 0–7 for the solenoid pairs, 8 FIRE, 9 RST,
10 ABRT.

## Real serial backend

Install `External/requirements.txt` in a Python virtual environment and make the
board project's `xplink` module available on `PYTHONPATH`, then run:

```bash
python3 External/monitor.py
# Optional override; otherwise tries /dev/ttyUSB0, then /dev/ttyUSB1:
ALPHA_SERIAL_PORT=/dev/ttyUSB0 python3 External/monitor.py
```

The backend retains 460800 baud, the original XPLink packet layouts, command
numbers and sensor scaling. It publishes at a target 100 Hz; actual cadence
still depends on OS scheduling. Serial reads drain available bytes in chunks,
and a separate writer keeps blocking writes off the WebSocket event loop.
Commands remain ordered, have a bounded queue and a 250 ms serial write timeout,
and are never automatically retried. Invalid commands close the client with
code 1008; write failures close it with code 1011. These are transport failures,
not acknowledgments of physical actuation.

One locked snapshot is encoded per tick and shared by all clients. Each client
holds at most one pending frame: a slow client receives the newest snapshot
rather than accumulating stale frames. Sends time out after one second. The
server sleeps while no clients are connected, and cancels both connection tasks
when either ends. Serial ports and workers open when the first client connects and close after
the last client disconnects. The server starts even without a board attached.
Use one server worker per serial device.

For USB serial, choose **Serial bridge** in the UI, enter the address of the
computer running this updated `External/monitor.py` (for a local device,
`localhost:3333`), and enter its port, such as `/dev/ttyUSB0`,
`/dev/cu.usbserial-…`, or `COM3`. The UI uses `/data?serial_port=…`; the bridge
opens that device at 460800 baud with the existing XPLink codec. This is a
bridge connection, not browser Web Serial. The `xplink` module is still required.
Clients selecting the same port share it; switching ports is rejected while
another client is using the current port. Errors appear in the connection
controls, and rejected port selections are not automatically retried.

Frames also include `time` (Unix seconds at snapshot creation) and
`serial_connected`. This timestamp is not a sensor acquisition timestamp. A
serial failure leaves the last readings visible with a stale-data indicator;
restore the hardware, disconnect all clients, then reconnect from the menu to
reopen the serial port. Unexpected socket loss retries automatically; an explicit
Disconnect or a rejected port selection does not. Reconnection never replays
commands.

## Telemetry rendering and checks

The UI ingests every received frame into fixed 1,440-sample buffers and publishes
live readings at roughly 30 Hz. This retains 12 seconds at 120 Hz, including a
full 10-second graph and its one-second averaging context. History snapshots are
published at **at most 10 Hz**, independently of live readings. Closed histories
release their materialized arrays; hidden windows skip display publication.

History has **3s / 5s / 10s** windows, defaulting to 5 seconds. A lightweight SVG
renderer draws two paths rather than constructing a chart-library scene. It keeps
every retained sample in the selected interval, including short spikes, and
supports a nearest-sample hover readout. The dashed line and adjacent **1s avg**
value use a trailing one-second sample mean, independent of graph zoom. All finite pressure values are retained, including negative values and values
above 5000: the former hard-coded cutoff produced artificial gaps despite the
units being unverified. Invalid samples remain gaps in the raw line and are
excluded from averages. Isolated valid samples render as dots, and the vertical
scale has a minimum span so tiny fluctuations do not fill the whole plot.
Snapshots marked `serial_connected: false` create gaps rather than plotting
retained readings as new measurements. The average
line and number continue while the trailing window contains valid samples,
and become unavailable when that window is empty. Startup uses available
samples; no earlier data is invented. Gaps longer than two seconds
break the lines, and backwards timestamps start a new history after a clock reset.
A note below the chart identifies missing/invalid data. Remaining discontinuities
can therefore come from the source: null/non-finite samples, serial outages,
missing frames, clock resets, or real jumps in measurements. Hardware data still
needs a bench check; visual changes do not smooth away real signal changes.
Raw retained measurements are not averaged or downsampled.

The rocket keeps one stable WebGL canvas across connection interruptions. Local
command locks reset separately. Its canvas is capped at 220×180 CSS pixels (smaller in the desktop fit layout) and
pixel ratio 1, uses a low-power renderer without antialiasing, and still renders
on orientation changes rather than continuously.

A Node-only, three-minute simulation at 120 incoming frames/s with one open
history reduced snapshot point allocations from 15,074,250 to 2,505,000 (83.4%).
The fixed numeric buffers use 460,800 bytes instead of 960,000 (52% less). These
are allocation/buffer measurements, not Safari process-memory measurements.
Browser memory profiling remains pending the user's explicit request.

The plumbing drawing is static; only its two pressure colors and four solenoid
paths subscribe to telemetry. The rocket renders when orientation changes.
Unknown/invalid readings display `--`, valid zero displays `0.00`, and invalid
pressures appear as chart gaps instead of invented zero measurements.

```bash
npm test                  # buffer, publication, validation and history tests
npm run test:backend      # use the environment with External/requirements.txt
npm run build:react
```

Backend tests use fake serial hardware/codecs and exercise FastAPI WebSockets.
They require `httpx` (`python3 -m pip install httpx`) but do not require XPLink or
an attached board. Physical packet interoperability and axis calibration still
need a bench check: the historical backend labels `acc` as heading/roll/pitch,
while the view and mock interpret it as yaw/pitch/roll. This optimization keeps
the existing numeric order and display mapping unchanged.

A local, instrumented development-browser comparison at 100 Hz (4-second
measurement windows, 1440×1000 viewport, same mock scenarios) recorded:

| Scenario | Before: main-thread task time | After | Reduction |
| --- | ---: | ---: | ---: |
| Changing telemetry, charts closed | 1.602 s | 0.717 s | 55% |
| Changing telemetry, one chart open | 1.907 s | 1.428 s | 25% |
| Constant telemetry, charts closed | 1.006 s | 0.064 s | 94% |

These are local diagnostic measurements, not guaranteed production or hardware
speedups. These measurements predate the Console redesign. The chart bundle
(now ~3.2 kB before gzip after replacing Recharts) is deferred until a sensor
history is selected.

## Console interface

The main `/` route and Electron app use the Console design. The original plumbing
SVG is the focal point, including all original path geometry, legends, gauges,
manual valves, regulators, and live pressure/solenoid updates. The schematic occupies the main canvas, with all 20 readings and sensor history
in a right-hand rail. Ignition state and phase progression sit across the top,
alongside connection status and settings. A horizontal command deck below the
schematic groups solenoids, continuity, and distinct Fire/Abort controls. The
attitude preview sits in the schematic header; recent activity occupies a footer.
At desktop sizes of at least 1000×600 CSS pixels, these fit in one window without
page scrolling. The activity list can scroll through recent messages. Smaller screens use a vertical layout to keep
controls readable. Electron opens maximized and no longer opens DevTools by
default.

The ignition strip reflects the board's state: Standby → Fire received → Ignite
→ Burning → Cooldown, with Abort and Unknown shown separately. It does not infer
phase changes from sent commands. All 20 channels are visible together in the
right-hand telemetry rail. Selecting a reading loads its actual retained history; closing history
releases that subscription. The small 3D rocket is always visible; yaw, pitch,
and roll remain available in the telemetry rows without a duplicate readout box.

Solenoid commands still require typing `UNLOCK`. Buttons, the original SVG, and
keys 1–4 share the same command checks. Unlocking and valve requests work offline,
including when the reported valve state is unknown (the first request is Open).
A pending valve shows the requested position separately from the board-reported
state. Waiting indicators appear immediately when the reported state is unknown
or unavailable; otherwise they appear only after one second without a matching
response. Buttons and schematic valves share this delay, retaining the reported
position during normal command round trips. Offline requests display **Disconnected · waiting for response** and are
never queued or replayed. Online requests remain pending until a later telemetry
frame reports the requested state; this is state observation, not a dedicated
command acknowledgment. Shortcuts ignore text entry, modifiers, and repeated
keydown events, and work when a button has focus. Ignition uses a separate enable
checkbox and Fire button; each send consumes that enable step. The activity log
reports sends and failures, not hardware acknowledgments. Reset is offered in the
board's abort state. Command numbers and the backend wire format are unchanged.

A missing valid frame for two seconds, socket loss, or a reported serial failure
marks readings unavailable/stale and resets local control enables. Retained values
and chart history remain visible. Abort remains independent of both locks and can
still be sent over an open transport when telemetry is stale (unless serial is
reported disconnected). Reconnection never replays commands.

Pressure, temperature, and thrust retain native values until physical units are
verified. Display labels are sequential channel indices: PT-01 is `pressures[0]`,
TC-01 is `temps[0]`, and LC-01 is `thrusts[0]`. They are not a new mapping of the
original schematic's hardware labels.

## UI design previews

Three interactive design directions are available alongside the current UI:

- `http://localhost:5173/?design=console` — dark, balanced monitoring with Alpha's yellow accent.
- `http://localhost:5173/?design=field` — high-contrast light layout with a wider sensor table.
- `http://localhost:5173/?design=analysis` — dense workspace with two persistent history plots.

Run `npm run dev:vite` if the frontend is not already running. Use the design
switcher to compare layouts, choose a sample scenario, select sensor rows, or
try the simulated controls. Each direction now puts a large flow diagram first,
with a prominent ignition phase strip and adjacent command controls. All 20
sensors are shown together below the diagram; selecting a reading focuses its
history. The scenario selector includes each ignition phase, abort, and loss of
connection. These routes load independently of the live app:
they use local synthetic data and never open a telemetry WebSocket or send
hardware commands. The ordinary `/` route opens the live Console interface.

These are design explorations, not operational replacements. The previews now
reuse the original plumbing SVG, history is generated sample data, and pressure,
temperature, and thrust are labeled with native units pending verification.
Disconnected previews retain the last selected sample with stale indicators.
The main Console has been checked in headless Chrome at 1000×600, 1024×768,
1280×720, 1366×768, and 1920×1080, plus a narrow 390px layout. Checks cover offline
shortcuts, pending/report states, SVG controls, manual disconnect/reconnect,
endpoint persistence, serial port selection, and connection errors. Backend tests
use fake serial hardware; physical device interoperability remains unverified.
The design-preview routes have not received this same browser QA.

Optional next step after choosing a direction: `$impeccable init` can capture
product and design conventions for subsequent implementation work.
