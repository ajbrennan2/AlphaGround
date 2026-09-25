import asyncio
from enum import IntEnum
from pathlib import Path
import struct
import sys
from threading import Event
import time
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "External"))
from monitor import (PacketDecoder, SerialBridge, TelemetryHub, TelemetryState,
                     COMMAND_QUEUE_SIZE, READ_CHUNK_SIZE, create_app, serve_client)
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

Messages = IntEnum("Messages", {name: i for i, name in enumerate(
    [f"TEMP{i}" for i in range(1, 5)] + [f"PRESSURE{i}" for i in range(1, 13)] +
    ["THRUST", "ACC", "SOLENOID", "SWITCHES", "XP_STATE"])})


class DecoderTests(unittest.TestCase):
    def setUp(self):
        self.state = TelemetryState()
        self.decoder = PacketDecoder(Messages, self.state)

    def apply(self, name, data):
        self.decoder.apply(SimpleNamespace(type=Messages[name].value, data=list(data)))

    def test_every_numeric_channel_preserves_width_scaling_and_index(self):
        for group, prefix, count in [("temps", "TEMP", 4), ("pressures", "PRESSURE", 12)]:
            for i in range(count):
                self.apply(f"{prefix}{i + 1}", (123456 + i).to_bytes(4, "little"))
            expected = [(123456 + i) * 1e-5 for i in range(count)]
            self.assertEqual(self.state.snapshot()[group], expected)
        self.apply("THRUST", b"\xff\xff\xff")
        self.assertEqual(self.state.snapshot()["thrusts"], [0xffffff * 1e-5])

    def test_signed_orientation_and_discrete_packet_order(self):
        self.apply("ACC", struct.pack("<hhh", -32768, 160, 32767))
        self.apply("SOLENOID", [1, 0, 1, 0])
        self.apply("SWITCHES", [1, 0])
        self.apply("XP_STATE", [5])
        out = self.state.snapshot()
        self.assertEqual(out["acc"], [32767 / 16, 10, -2048])
        self.assertEqual(out["solenoids"], [0, 1, 0, 1])
        self.assertEqual((out["burn"], out["keys"], out["state"]), ([1], [0], 5))

    def test_short_and_unknown_packets_do_not_modify_state(self):
        for name in Messages.__members__:
            self.apply(name, [])
        self.decoder.apply(SimpleNamespace(type=999, data=[]))
        self.assertEqual(self.state.snapshot()["temps"], [None] * 4)

    def test_snapshots_do_not_alias_mutable_state(self):
        first = self.state.snapshot()
        self.apply("TEMP1", (100000).to_bytes(4, "little"))
        self.assertEqual(first["temps"], [None] * 4)
        self.assertEqual(self.state.snapshot()["temps"][0], 1)


class FakeSerial:
    def __init__(self, data=b"", write_delay=0, fail=False):
        self.data = bytearray(data)
        self.read_sizes = []
        self.writes = []
        self.closed = Event()
        self.write_started = Event()
        self.write_delay = write_delay
        self.fail = fail

    @property
    def in_waiting(self):
        return len(self.data)

    def read(self, size):
        self.read_sizes.append(size)
        if not self.data:
            self.closed.wait(0.01)
        out = self.data[:size]
        del self.data[:size]
        return out

    def write(self, payload):
        self.write_started.set()
        time.sleep(self.write_delay)
        if self.fail:
            raise OSError("test serial failure")
        self.writes.append(payload)
        return len(payload)

    def close(self):
        self.closed.set()


class Codec:
    def __init__(self):
        self.received = []

    def XPLINK_UNPACK(self, byte):
        self.received.append(byte)
        return None

    def XPLINK_PACK(self, packet):
        return [packet.END_BYTE, packet.sender_id, packet.type, packet.data]


def bridge_for(serial=None):
    return SerialBridge(serial or FakeSerial(), Codec(), Codec(), SimpleNamespace, Messages)


class SerialTests(unittest.TestCase):
    def test_chunked_reads_preserve_all_bytes_and_command_order(self):
        serial = FakeSerial(bytes(range(256)) * 32)
        bridge = bridge_for(serial)
        try:
            bridge.start()
            results = [bridge.submit(command) for command in (0, 8, 10, 9)]
            for result in results:
                result.result(timeout=1)
            deadline = time.monotonic() + 1
            while len(bridge.receiver.received) < 8192 and time.monotonic() < deadline:
                time.sleep(0.001)
            self.assertEqual(bridge.receiver.received, list(bytes(range(256)) * 32))
            self.assertEqual(serial.read_sizes[:2], [READ_CHUNK_SIZE] * 2)
            self.assertEqual(serial.writes, [bytes([0, 0xaa, 0, c]) for c in (0, 8, 10, 9)])
        finally:
            bridge.close()
        self.assertTrue(all(not thread.is_alive() for thread in bridge.threads))
        self.assertTrue(serial.closed.is_set())

    def test_invalid_and_overflow_commands_are_rejected(self):
        bridge = bridge_for()
        try:
            for command in (True, False, -1, 11, 8.0, "8", None):
                with self.assertRaises(ValueError):
                    bridge.submit(command)
            for _ in range(COMMAND_QUEUE_SIZE):
                bridge.submit(0)
            with self.assertRaises(RuntimeError):
                bridge.submit(8)
        finally:
            bridge.close()

    def test_cancelled_queued_commands_are_not_sent(self):
        bridge = bridge_for()
        first = bridge.submit(8)
        self.assertTrue(first.cancel())
        try:
            bridge.start()
            bridge.submit(10).result(timeout=1)
            self.assertEqual(bridge.serial.writes, [bytes([0, 0xaa, 0, 10])])
        finally:
            bridge.close()

    def test_write_failure_fails_pending_commands_without_retry(self):
        bridge = bridge_for(FakeSerial(fail=True))
        pending = [bridge.submit(8), bridge.submit(10)]
        try:
            with self.assertLogs("alphaground", level="ERROR"):
                bridge.start()
                for result in pending:
                    with self.assertRaises((OSError, RuntimeError)):
                        result.result(timeout=1)
            self.assertEqual(bridge.serial.writes, [])
        finally:
            bridge.close()


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_frames_and_bounded_slow_client_queue(self):
        state = TelemetryState()
        hub = TelemetryHub(state)
        first, slow = hub.subscribe(), hub.subscribe()
        task = asyncio.create_task(hub.run())
        try:
            payload = await asyncio.wait_for(first.get(), 0.2)
            self.assertIs(payload, slow.get_nowait())
            state.update([("state", None, 5)])
            await asyncio.sleep(0.06)
            self.assertEqual(slow.qsize(), 1)
            self.assertIn('"state":5', slow.get_nowait())
            hub.unsubscribe(first); hub.unsubscribe(slow)
            await asyncio.sleep(0.02)
            self.assertFalse(hub.active.is_set())
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def test_serial_write_does_not_block_telemetry(self):
        bridge = bridge_for(FakeSerial(write_delay=0.15))
        bridge.start()
        hub = TelemetryHub(bridge.state)
        queue = hub.subscribe()
        publisher = asyncio.create_task(hub.run())
        try:
            command = asyncio.wrap_future(bridge.submit(8))
            times = []
            for _ in range(5):
                await asyncio.wait_for(queue.get(), 0.1)
                times.append(time.monotonic())
            self.assertFalse(command.done())
            self.assertLess(times[-1] - times[0], 0.1)
            await command
        finally:
            publisher.cancel()
            await asyncio.gather(publisher, return_exceptions=True)
            await asyncio.to_thread(bridge.close)

    async def test_disconnect_cancels_sender_and_removes_subscription(self):
        class DisconnectedSocket:
            async def accept(self): pass
            async def receive_text(self): raise WebSocketDisconnect()
            async def send_text(self, payload): await asyncio.Future()
        hub = TelemetryHub(TelemetryState())
        await asyncio.wait_for(serve_client(DisconnectedSocket(), bridge_for(), hub), 0.2)
        self.assertFalse(hub.clients)


class WebSocketTests(unittest.TestCase):
    def test_manual_port_selection_releases_port_and_supports_reconnect(self):
        opened = []
        def open_port(port):
            bridge = bridge_for()
            opened.append((port, bridge))
            return bridge
        app = create_app(port_factory=open_port)
        with TestClient(app) as client:
            self.assertIsNone(app.state.bridge)
            with client.websocket_connect("/data?serial_port=COM7") as ws:
                self.assertTrue(ws.receive_json()["serial_connected"])
                self.assertEqual(opened[0][0], "COM7")
                with client.websocket_connect("/data?serial_port=COM8") as other:
                    self.assertIn("different serial port", other.receive_json()["connection_error"])
                self.assertTrue(ws.receive_json()["serial_connected"])
            deadline = time.monotonic() + 1
            while app.state.users and time.monotonic() < deadline:
                time.sleep(0.005)
            self.assertTrue(opened[0][1].serial.closed.is_set())
            with client.websocket_connect("/data?serial_port=COM8") as ws:
                self.assertTrue(ws.receive_json()["serial_connected"])
                self.assertEqual(opened[1][0], "COM8")

    def test_missing_default_hardware_does_not_prevent_manual_connection(self):
        def fail():
            raise RuntimeError("Default port unavailable")
        app = create_app(bridge_factory=fail, port_factory=lambda port: bridge_for())
        with TestClient(app) as client:
            with client.websocket_connect("/data") as ws:
                self.assertEqual(ws.receive_json()["connection_error"], "Default port unavailable")
            with client.websocket_connect("/data?serial_port=/dev/ttyUSB2") as ws:
                self.assertTrue(ws.receive_json()["serial_connected"])

    def test_same_port_clients_share_hardware_until_last_disconnect(self):
        bridge = bridge_for()
        app = create_app(port_factory=lambda port: bridge)
        with TestClient(app) as client:
            with client.websocket_connect("/data?serial_port=COM7") as first:
                first.receive_json()
                with client.websocket_connect("/data?serial_port=COM7") as second:
                    second.receive_json()
                    self.assertEqual(app.state.users, 2)
                self.assertFalse(bridge.serial.closed.is_set())
                self.assertTrue(first.receive_json()["serial_connected"])
        self.assertTrue(bridge.serial.closed.is_set())

    def test_lifespan_telemetry_command_validation_and_shutdown(self):
        bridge = bridge_for()
        app = create_app(lambda: bridge)
        with TestClient(app) as client:
            with client.websocket_connect("/data") as ws:
                snapshot = ws.receive_json()
                self.assertEqual(len(snapshot["pressures"]), 12)
                self.assertTrue(snapshot["serial_connected"])
                ws.send_json({"command": 10})
                deadline = time.monotonic() + 1
                while not bridge.serial.writes and time.monotonic() < deadline:
                    time.sleep(0.001)
                self.assertEqual(bridge.serial.writes, [bytes([0, 0xaa, 0, 10])])
                ws.send_json({"command": True})
                with self.assertRaises(WebSocketDisconnect) as raised:
                    while True:
                        ws.receive_json()
                self.assertEqual(raised.exception.code, 1008)
        self.assertTrue(bridge.serial.closed.is_set())
        self.assertFalse(app.state.hub.clients)


if __name__ == "__main__":
    unittest.main()
