import concurrent.futures
import threading
import time
import unittest
from unittest.mock import patch

from npsl_tools.instruments.instrument_8508A import Instrument8508A


class FakeDevice:
    def __init__(self):
        self.timeout = None
        self.read_termination = None
        self.write_termination = None
        self.commands = []
        self.current_input = "FRONT"
        self.previous_input = "FRONT"
        self.stale_after_switch = False
        self.closed = False
        self._guard = threading.Lock()

    def write(self, command):
        with self._guard:
            self.commands.append(("write", command))
            if command.startswith("INPUT "):
                selected = command.split()[-1]
                if selected in ("FRONT", "REAR") and selected != self.current_input:
                    self.previous_input = self.current_input
                    self.current_input = selected
                    self.stale_after_switch = True

    def query(self, command):
        with self._guard:
            self.commands.append(("query", command))
            if command == "*OPT?":
                return "8508A/01\n"
            if command == "*IDN?":
                return "FLUKE,8508A,1234,1.0\n"
            if command == "X?":
                # The first conversion after a relay transition represents
                # stale data from the prior input. The driver must discard it.
                time.sleep(0.002)
                selected = self.current_input
                if self.stale_after_switch:
                    selected = self.previous_input
                    self.stale_after_switch = False
                return "1.0\n" if selected == "FRONT" else "2.0\n"
            return "0\n"

    def close(self):
        self.closed = True


class FakeResourceManager:
    def __init__(self, device):
        self.device = device
        self.open_count = 0
        self.closed = False

    def open_resource(self, address):
        self.open_count += 1
        return self.device

    def close(self):
        self.closed = True


class Instrument8508ATests(unittest.TestCase):
    def setUp(self):
        Instrument8508A._connections.clear()
        self.device = FakeDevice()
        self.rm = FakeResourceManager(self.device)
        self.patch = patch(
            "npsl_tools.instruments.instrument_8508A.pyvisa.ResourceManager",
            return_value=self.rm,
        )
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        Instrument8508A._connections.clear()

    def test_initialization_explicitly_sets_required_acv_configuration(self):
        instrument = Instrument8508A("GPIB0::8::INSTR")
        writes = [command for kind, command in self.device.commands if kind == "write"]
        self.assertEqual(
            writes[:5],
            [
                "*RST",
                "*CLS",
                "ACV AUTO,FILT40HZ,RESL6,TFER_ON,TWO_WR",
                "TRG_SRCE EXT",
                "DELAY DFLT",
            ],
        )
        instrument.close()

    def test_front_and_rear_readers_share_one_connection_and_serialize(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        rear = Instrument8508A("GPIB0::8::INSTR", "REAR")

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            values = list(pool.map(lambda inst: inst.read_instrument(), (front, rear)))

        self.assertEqual(values, [1.0, 2.0])
        self.assertEqual(self.rm.open_count, 1)

        front.close()
        self.assertFalse(self.device.closed)
        rear.close()
        self.assertTrue(self.device.closed)

    def test_paired_reads_alternate_order_without_changing_tuple_roles(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        rear = Instrument8508A("GPIB0::8::INSTR", "REAR")
        self.device.commands.clear()

        self.assertEqual(front.read_pair(rear), (1.0, 2.0))
        self.assertEqual(front.read_pair(rear, reverse_order=True), (1.0, 2.0))

        input_writes = [
            command
            for kind, command in self.device.commands
            if kind == "write" and command.startswith("INPUT ")
        ]
        self.assertEqual(
            input_writes,
            ["INPUT REAR", "INPUT FRONT"],
        )
        x_queries = [
            command
            for kind, command in self.device.commands
            if kind == "query" and command == "X?"
        ]
        # First FRONT reading is purged after initialization; every physical
        # FRONT/REAR transition also receives one unsaved purge conversion.
        self.assertEqual(len(x_queries), 7)
        front.close()
        rear.close()

    def test_function_change_purges_before_returning_a_saved_reading(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        self.device.commands.clear()

        front.configure_dc_voltage()
        self.assertEqual(front.read_instrument(), 1.0)

        commands = self.device.commands
        self.assertEqual(commands[0], ("write", "DCV AUTO,FILT_ON,RESL6,FAST_OFF,TWO_WR"))
        self.assertEqual(
            [entry for entry in commands if entry == ("query", "X?")],
            [("query", "X?"), ("query", "X?")],
        )
        front.close()

    def test_rear_input_requires_8508a_01_option(self):
        original_query = self.device.query

        def no_rear_option(command):
            if command == "*OPT?":
                return "8508A\n"
            return original_query(command)

        self.device.query = no_rear_option
        with self.assertRaisesRegex(RuntimeError, "8508A/01"):
            Instrument8508A("GPIB0::8::INSTR", "REAR")


if __name__ == "__main__":
    unittest.main()
