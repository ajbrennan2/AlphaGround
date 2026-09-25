"""Serial acquisition and a shared 100 Hz WebSocket telemetry stream.

XPLink is supplied by the board project. Importing this module does not open a
serial port; hardware is acquired and released with the FastAPI lifespan.
"""
import asyncio
from anyio import CancelScope
from concurrent.futures import Future
from contextlib import asynccontextmanager
import json
import logging
import os
from queue import Empty, Full, Queue
import struct
from threading import Event, Lock, Thread
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

LOG = logging.getLogger("alphaground")
COUNTS = {"temps": 4, "pressures": 12, "thrusts": 1, "solenoids": 4,
          "acc": 3, "keys": 1, "burn": 1}
TELEMETRY_HZ = 100
READ_CHUNK_SIZE = 4096
COMMAND_QUEUE_SIZE = 64


class TelemetryState:
    def __init__(self):
        self.lock = Lock()
        self.data = {key: [None] * count for key, count in COUNTS.items()}
        self.data.update(going=0, state=0)
        self.serial_connected = False

    def update(self, changes):
        # Multi-axis / multi-switch packets are published atomically.
        with self.lock:
            for group, index, value in changes:
                if index is None:
                    self.data[group] = value
                else:
                    self.data[group][index] = value

    def set_connected(self, connected):
        with self.lock:
            self.serial_connected = connected

    def snapshot(self):
        with self.lock:
            result = {key: value[:] if isinstance(value, list) else value
                      for key, value in self.data.items()}
            result["serial_connected"] = self.serial_connected
        result["time"] = time.time()
        return result


class PacketDecoder:
    def __init__(self, message_types, state):
        self.state = state
        self.handlers = {}
        # Resolve enum names once, instead of converting an enum per packet.
        for message in message_types:
            name = message.name
            if name.startswith("TEMP") and name[4:].isdigit():
                self.handlers[message.value] = ("temps", int(name[4:]) - 1, 4)
            elif name.startswith("PRESSURE") and name[8:].isdigit():
                self.handlers[message.value] = ("pressures", int(name[8:]) - 1, 4)
            elif name == "THRUST":
                self.handlers[message.value] = ("thrusts", 0, 3)
            elif name in ("ACC", "SOLENOID", "XP_STATE", "SWITCHES"):
                self.handlers[message.value] = name

    def apply(self, packet):
        handler = self.handlers.get(packet.type)
        if handler is None:
            return
        data = packet.data
        if isinstance(handler, tuple):
            group, index, width = handler
            if not 0 <= index < COUNTS[group] or len(data) < width:
                return
            value = int.from_bytes(bytes(data[:width]), "little") * 1e-5
            changes = [(group, index, value)]
        elif handler == "ACC":
            if len(data) < 6:
                return
            z, y, x = struct.unpack("<hhh", bytes(data[:6]))
            # Preserve the existing wire order/scaling. Axis calibration is a
            # separate hardware change, not part of the performance refactor.
            changes = [("acc", 0, x / 16), ("acc", 1, y / 16), ("acc", 2, z / 16)]
        elif handler == "SOLENOID":
            if len(data) < 4:
                return
            changes = [("solenoids", i, data[3 - i]) for i in range(4)]
        elif handler == "XP_STATE":
            if len(data) < 1:
                return
            changes = [("state", None, data[0])]
        else:
            if len(data) < 2:
                return
            changes = [("burn", 0, data[0]), ("keys", 0, data[1])]
        self.state.update(changes)


class SerialBridge:
    def __init__(self, serial_port, receiver, transmitter, packet_factory, message_types):
        self.serial = serial_port
        # Independent XPLink objects: packing and unpacking never share mutable
        # parser state between threads.
        self.receiver = receiver
        self.transmitter = transmitter
        self.packet_factory = packet_factory
        self.state = TelemetryState()
        self.decoder = PacketDecoder(message_types, self.state)
        self.commands = Queue(maxsize=COMMAND_QUEUE_SIZE)
        self.stopped = Event()
        self.threads = []

    @classmethod
    def open(cls, port=None):
        import serial
        from xplink import XPLink, xp_packet_t, xp_msg_t

        selected = port or os.environ.get("ALPHA_SERIAL_PORT")
        ports = [selected] if selected else ["/dev/ttyUSB0", "/dev/ttyUSB1"]
        last_error = None
        for port in ports:
            try:
                connection = serial.Serial(port, 460800, timeout=0.1, write_timeout=0.25)
                try:
                    return cls(connection, XPLink(), XPLink(), xp_packet_t, xp_msg_t)
                except Exception:
                    connection.close()
                    raise
            except serial.SerialException as error:
                last_error = error
        raise RuntimeError("Could not open serial connection: " + ", ".join(ports)) from last_error

    def start(self):
        self.state.set_connected(True)
        self.threads = [Thread(target=self._receive, name="serial-reader", daemon=True),
                        Thread(target=self._write, name="serial-writer", daemon=True)]
        for thread in self.threads:
            thread.start()

    def submit(self, command):
        if type(command) is not int or not 0 <= command <= 10:
            raise ValueError("Command must be an integer from 0 to 10")
        if self.stopped.is_set():
            raise RuntimeError("Serial connection is unavailable")
        result = Future()
        try:
            self.commands.put_nowait((command, result))
        except Full as error:
            raise RuntimeError("Serial command queue is full") from error
        # Cover a receive failure racing the enqueue after the availability check.
        if self.stopped.is_set():
            self._fail_pending()
        return result

    def _receive(self):
        try:
            while not self.stopped.is_set():
                # Block for one byte when idle, drain available bytes in bounded
                # chunks when busy. Never wait for a large block to fill.
                chunk = self.serial.read(min(READ_CHUNK_SIZE, max(1, self.serial.in_waiting)))
                for byte in chunk:
                    packet = self.receiver.XPLINK_UNPACK(byte)
                    if packet:
                        self.decoder.apply(packet)
        except Exception:
            LOG.exception("Serial receive failed")
            self.stopped.set()
        finally:
            self.state.set_connected(False)

    def _write(self):
        try:
            while not self.stopped.is_set():
                try:
                    command, result = self.commands.get(timeout=0.1)
                except Empty:
                    continue
                if not result.set_running_or_notify_cancel():
                    continue
                try:
                    if self.stopped.is_set():
                        raise RuntimeError("Serial connection is unavailable")
                    packet = self.packet_factory()
                    packet.END_BYTE = 0x00
                    packet.sender_id = 0xAA
                    packet.type = 0
                    packet.data = command
                    payload = bytes(self.transmitter.XPLINK_PACK(packet))
                    if self.serial.write(payload) != len(payload):
                        raise OSError("Incomplete serial command write")
                    result.set_result(None)
                except Exception as error:
                    result.set_exception(error)
                    LOG.exception("Serial command failed; commands will not be retried")
                    self.stopped.set()
        finally:
            self.state.set_connected(False)
            self._fail_pending()

    def _fail_pending(self):
        while True:
            try:
                _, result = self.commands.get_nowait()
            except Empty:
                return
            if result.set_running_or_notify_cancel():
                result.set_exception(RuntimeError("Serial connection is unavailable"))

    def close(self):
        self.stopped.set()
        for thread in self.threads:
            thread.join(timeout=1)
        self.serial.close()
        self._fail_pending()
        self.state.set_connected(False)


class TelemetryHub:
    def __init__(self, state):
        self.state = state
        self.clients = set()
        self.active = asyncio.Event()

    def subscribe(self):
        queue = asyncio.Queue(maxsize=1)
        self.clients.add(queue)
        self.active.set()
        return queue

    def unsubscribe(self, queue):
        self.clients.discard(queue)
        if not self.clients:
            self.active.clear()

    async def run(self):
        loop = asyncio.get_running_loop()
        interval = 1 / TELEMETRY_HZ
        deadline = loop.time()
        while True:
            await self.active.wait()
            # One coherent snapshot and one JSON encoding for all clients.
            payload = json.dumps(self.state.snapshot(), separators=(",", ":"), allow_nan=False)
            for queue in self.clients:
                if queue.full():
                    queue.get_nowait()  # Slow clients get current telemetry, not a backlog.
                queue.put_nowait(payload)
            deadline += interval
            if deadline <= loop.time():
                deadline = loop.time() + interval
            await asyncio.sleep(max(0, deadline - loop.time()))


async def serve_client(websocket, bridge, hub):
    await websocket.accept()
    queue = hub.subscribe()

    async def send_telemetry():
        while True:
            payload = await queue.get()
            await asyncio.wait_for(websocket.send_text(payload), timeout=1)

    async def receive_commands():
        while True:
            raw = await websocket.receive_text()
            if len(raw) > 256:
                raise ValueError("Command is too large")
            message = json.loads(raw)
            if not isinstance(message, dict):
                raise ValueError("Expected a command object")
            await asyncio.wrap_future(bridge.submit(message.get("command")))

    tasks = [asyncio.create_task(send_telemetry()), asyncio.create_task(receive_commands())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except WebSocketDisconnect:
        pass
    except (ValueError, TypeError):
        await websocket.close(code=1008, reason="Expected an integer command from 0 to 10")
    except Exception:
        LOG.exception("WebSocket connection failed")
        try:
            await websocket.close(code=1011, reason="Telemetry or serial connection failed")
        except (RuntimeError, OSError):
            pass
    finally:
        hub.unsubscribe(queue)
        for task in tasks:
            task.cancel()
        with CancelScope(shield=True):
            await asyncio.gather(*tasks, return_exceptions=True)


def create_app(bridge_factory=SerialBridge.open, port_factory=SerialBridge.open):
    # Open hardware on demand so the menu can choose a port even when the default
    # USB device is absent. One shared bridge; a different port cannot displace
    # another operator's active connection.
    @asynccontextmanager
    async def lifespan(app):
        app.state.connection_lock = asyncio.Lock()
        app.state.bridge = None
        app.state.hub = None
        app.state.publisher = None
        app.state.port = None
        app.state.users = 0
        try:
            yield
        finally:
            async with app.state.connection_lock:
                await close_bridge(app)

    async def close_bridge(app):
        if app.state.publisher is not None:
            app.state.publisher.cancel()
            await asyncio.gather(app.state.publisher, return_exceptions=True)
            app.state.publisher = None
        if app.state.bridge is not None:
            await asyncio.to_thread(app.state.bridge.close)
            app.state.bridge = None

    app = FastAPI(lifespan=lifespan)

    @app.websocket("/data")
    async def websocket_endpoint(websocket: WebSocket):
        port = websocket.query_params.get("serial_port") or None
        if port is not None:
            port = port.strip()
            if not port or len(port) > 256 or any(ord(char) < 32 for char in port):
                await websocket.accept()
                await websocket.send_json({"connection_error": "Enter a valid serial port."})
                await websocket.close(code=1008)
                return
        try:
            async with app.state.connection_lock:
                if app.state.users and port != app.state.port:
                    raise RuntimeError("Another client is using a different serial port. Disconnect that client before switching ports.")
                if app.state.bridge is None:
                    bridge = await asyncio.to_thread(port_factory, port) if port else await asyncio.to_thread(bridge_factory)
                    try:
                        bridge.start()
                    except Exception:
                        await asyncio.to_thread(bridge.close)
                        raise
                    app.state.bridge = bridge
                    app.state.port = port
                    app.state.hub = TelemetryHub(bridge.state)
                    app.state.publisher = asyncio.create_task(app.state.hub.run())
                app.state.users += 1
                bridge, hub = app.state.bridge, app.state.hub
        except Exception as error:
            LOG.warning("Connection could not be opened: %s", error)
            await websocket.accept()
            await websocket.send_json({"connection_error": str(error)})
            await websocket.close(code=1008)
            return
        try:
            await serve_client(websocket, bridge, hub)
        finally:
            # A browser closing or an ASGI cancellation must still release the
            # hardware and finish the publisher before the next port is opened.
            with CancelScope(shield=True):
                async with app.state.connection_lock:
                    app.state.users -= 1
                    if not app.state.users:
                        await close_bridge(app)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3333, log_level="info", ws="websockets")
