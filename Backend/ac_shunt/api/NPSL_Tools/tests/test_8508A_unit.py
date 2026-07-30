import concurrent.futures
import threading
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
        self.closed = False
        self._guard = threading.Lock()

    def write(self, command):
        with self._guard:
            self.commands.append(("write", command))
            if command.startswith("INPUT "):
                selected = command.split()[-1]
                if selected in ("FRONT", "REAR"):
                    self.current_input = selected

    def query(self, command):
        with self._guard:
            self.commands.append(("query", command))
            if command == "*OPT?":
                return "8508A/01\n"
            if command == "*IDN?":
                return "FLUKE,8508A,1234,1.0\n"
            if command in ("RDG?", "X?"):
                return "1.0\n" if self.current_input == "FRONT" else "2.0\n"
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
        self.rm_patch = patch(
            "npsl_tools.instruments.instrument_8508A.pyvisa.ResourceManager",
            return_value=self.rm,
        )
        self.sleep_patch = patch(
            "npsl_tools.instruments.instrument_8508A.time.sleep"
        )
        self.mock_sleep = self.sleep_patch.start()
        self.rm_patch.start()

    def tearDown(self):
        self.rm_patch.stop()
        self.sleep_patch.stop()
        Instrument8508A._connections.clear()

    def test_initialization_sets_safe_y5020_dcv_and_internal_trigger(self):
        instrument = Instrument8508A("GPIB0::8::INSTR")
        writes = [command for kind, command in self.device.commands if kind == "write"]
        self.assertEqual(
            writes[:4],
            [
                "*RST",
                "*CLS",
                "DCV 0.1,FILT_ON,RESL7,FAST_OFF,TWO_WR",
                "TRG_SRCE INT",
            ],
        )
        self.assertEqual(instrument.get_acquisition_profile()["trigger_source"], "INT")
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

    def test_paired_internal_reads_alternate_order_without_changing_roles(self):
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
        self.assertEqual(input_writes, ["INPUT REAR", "INPUT FRONT"])
        rdg_queries = [
            command
            for kind, command in self.device.commands
            if kind == "query" and command == "RDG?"
        ]
        self.assertEqual(len(rdg_queries), 5)
        self.assertFalse(any(
            command.startswith("DELAY ")
            for kind, command in self.device.commands
            if kind == "write"
        ))
        front.close()
        rear.close()

    def test_function_change_discards_one_internal_conversion(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        self.device.commands.clear()

        front.configure_dc_voltage()
        self.assertEqual(front.read_instrument(), 1.0)

        self.assertEqual(
            self.device.commands[0],
            ("write", "DCV AUTO,FILT_ON,RESL6,FAST_OFF,TWO_WR"),
        )
        self.assertEqual(
            [entry for entry in self.device.commands if entry == ("query", "RDG?")],
            [("query", "RDG?"), ("query", "RDG?")],
        )
        front.close()

    def test_source_transition_discards_one_completed_conversion(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        self.device.commands.clear()
        self.mock_sleep.reset_mock()

        front.mark_source_transition(
            stage="dc_pos",
            cycle_index=2,
            source_voltage_v=0.1,
        )
        self.assertEqual(front.read_instrument(), 1.0)

        rdg_queries = [
            command
            for kind, command in self.device.commands
            if kind == "query" and command == "RDG?"
        ]
        self.assertEqual(rdg_queries, ["RDG?", "RDG?"])
        self.assertFalse(front._shared.source_transition_pending)
        self.assertEqual(front._shared.source_transition_context, {})
        self.mock_sleep.assert_any_call(front._shared.conversion_delay_s)
        front.close()

    def test_operator_switch_delay_is_used_in_both_directions(self):
        front = Instrument8508A("GPIB0::8::INSTR", "FRONT")
        rear = Instrument8508A("GPIB0::8::INSTR", "REAR")
        front.set_input_switch_delay(2.5)
        self.mock_sleep.reset_mock()

        self.assertEqual(front.read_pair(rear), (1.0, 2.0))
        self.mock_sleep.assert_any_call(2.5)

        self.mock_sleep.reset_mock()
        self.assertEqual(front.read_pair(rear, reverse_order=True), (1.0, 2.0))
        self.mock_sleep.assert_any_call(2.5)
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
