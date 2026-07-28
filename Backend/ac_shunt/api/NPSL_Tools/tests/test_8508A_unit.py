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
        self.programmed_delay = None
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
            elif command.startswith("DELAY "):
                token = command.split()[-1]
                self.programmed_delay = None if token == "DFLT" else float(token)

    def query(self, command):
        with self._guard:
            self.commands.append(("query", command))
            if command == "*OPT?":
                return "8508A/01\n"
            if command == "*IDN?":
                return "FLUKE,8508A,1234,1.0\n"
            if command == "X?":
                # A scan-equivalent delay lets the physical path settle before
                # the fresh conversion. Without it, emulate stale prior-input
                # data so the test detects an undersettled switch.
                time.sleep(0.002)
                selected = self.current_input
                if self.stale_after_switch and self.programmed_delay is None:
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

    def test_initialization_explicitly_sets_tvc_output_dcv_configuration(self):
        instrument = Instrument8508A("GPIB0::8::INSTR")
        writes = [command for kind, command in self.device.commands if kind == "write"]
        self.assertEqual(
            writes[:5],
            [
                "*RST",
                "*CLS",
                "DCV 0.01,FILT_ON,RESL6,FAST_OFF,TWO_WR",
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
        # The initial function-state invalidation receives one purge. Each
        # physical transition then gets one fresh conversion after the
        # scan-equivalent delay rather than an undersettled purge/save pair.
        self.assertEqual(len(x_queries), 5)
        delay_writes = [
            command
            for kind, command in self.device.commands
            if kind == "write" and command.startswith("DELAY ")
        ]
        self.assertEqual(
            delay_writes,
            ["DELAY 1", "DELAY DFLT", "DELAY 1", "DELAY DFLT"],
        )
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

    def test_input_switch_delay_can_be_set_independently(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        rear = Instrument8508A("GPIB0::8::INSTR", "REAR")
        front.set_input_switch_delay(2.5)
        self.device.commands.clear()

        self.assertEqual(front.read_pair(rear), (1.0, 2.0))

        delay_writes = [
            command
            for kind, command in self.device.commands
            if kind == "write" and command.startswith("DELAY ")
        ]
        self.assertEqual(delay_writes, ["DELAY 2.5", "DELAY DFLT"])
        front.close()
        rear.close()

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
