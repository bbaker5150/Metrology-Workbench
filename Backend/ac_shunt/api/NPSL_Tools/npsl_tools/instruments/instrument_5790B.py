"""Fluke 5790B AC Measurement Standard class file

Contains functions specific to the 5790B such as triggering a measurement, 
setting digital filters, and taking measurements

"""
from .fluke_instrument import FlukeInstrument
from .instrument import Instrument 
from .utils import BoolSetting
from enum import Enum
import time

class DFILT_5790B_MODE(int, Enum):
    OFF = 1
    SLOW = 2
    MEDIUM = 3
    FAST = 4

class DFILT_5790B_RESTART(int, Enum):
    FINE = 1
    COARSE = 2
    MEDIUM = 3

class MEASUREMENT_STATUS_5790B(int, Enum):
    VALID = 0
    FREQ_UNDER = 1
    FREQ_OVER = 2
    SETTLED_NOT_FULL = 3
    UNSETTLED = 4
    UNDER_RANGE = 5
    OVER_RANGE = 6
    INVALID = 7

class TEST_POINT_TYPE_5790B(int, Enum):
    DC = 0
    SERVICE = 1
    AC = 2
    LIN = 3
    GAIN = 4
    FLAT = 5

class Instrument5790B(FlukeInstrument):
    """5790B Instrument class
    
    Attributes:
        model : str
            The model number of the instrument. Defaults to "5790B"
        gpib : str
            The GPIB address for the instrument
        timeout : float
            Time in milliseconds before commands timeout
        resource : pyvisa.resources.Resource
            PyVisa Resource that connects to the instrument
    """
    VALID_INPUTS = {"INPUT1", "INPUT2"}
    VALID_FILTER_MODES = {"OFF", "SLOW", "MEDIUM", "FAST"}
    VALID_FILTER_RESTARTS = {"FINE", "COARSE", "MEDIUM"}

    def __init__(self, model: str, gpib: str, timeout: float=60000):
        # Re-enable the parent identity check by calling the FlukeInstrument constructor.
        # This will raise an error if the connected device is not a 5790B.
        super().__init__(model=model, gpib=gpib, timeout=timeout)
        
        self.set_auto_range()
        self.set_input("INPUT2")
        self.input_switch_delay = 1.0

    def read_instrument(self):
        """
        Unified method to take a reading. Manually triggers, waits for the
        operation to complete, and then gets the value using MEAS?.
        """
        voltage, _, _ = self.send_MEAS()
        return voltage

    def _parse_cal_steps(self, query: str, test_points: list = []):
        """Parse the 5790B output when querying the cal steps."""
        cal_types = {
            "cal_dc? input1": TEST_POINT_TYPE_5790B.DC,
            "cal_i2?": TEST_POINT_TYPE_5790B.SERVICE,
            "cal_ac? input1": TEST_POINT_TYPE_5790B.AC,
            "cal_wblin?": TEST_POINT_TYPE_5790B.LIN,
            "cal_dc? wbnd": TEST_POINT_TYPE_5790B.GAIN,
            "cal_ac? wbnd": TEST_POINT_TYPE_5790B.FLAT,
        }
        if query not in cal_types.keys():
            raise RuntimeError(f"Invalid cal step query: {query}")
            
        self.resource.read_termination = ""
        output = self.resource.query(query)
        if query == "cal_dc? wbnd" or query == "cal_ac? wbnd":
            output = output[2::].strip().split("\n")
        else:
            output = output[3::].strip().split("\n")
        self.resource.read_termination = "\n"

        itr = 0
        while itr < len(output):
            test_range_list = output[itr].split(',')
            test_range = float(test_range_list[0])
            num_points = int(test_range_list[1])

            for j in range(itr + 1, itr + num_points + 1):
                test_point_list = output[j].split(',')
                voltage = float(test_point_list[0])
                frequency = float(test_point_list[1])

                if cal_types[query] in [TEST_POINT_TYPE_5790B.GAIN, TEST_POINT_TYPE_5790B.FLAT, TEST_POINT_TYPE_5790B.LIN]:
                    spec = float(self.resource.query(f'cal_spec? wbnd,{voltage},{frequency}'))
                elif cal_types[query] == TEST_POINT_TYPE_5790B.AC:
                    spec = float(self.resource.query(f'cal_spec? input1,{voltage},{frequency}'))
                elif cal_types[query] == TEST_POINT_TYPE_5790B.DC:
                    spec = float(self.resource.query(f'cal_spec? input1,{abs(voltage)},1000' if abs(voltage) <= 0.07 else f'cal_spec? input1,{voltage},{frequency}'))
                elif cal_types[query] == TEST_POINT_TYPE_5790B.SERVICE:
                    spec = float(self.resource.query(f"cal_spec? input1,{voltage},{frequency}"))

                point = { 'range': test_range, 'nominal': voltage, 'frequency': frequency, 'function': cal_types[query], 'spec': spec }
                test_points.append(point)
            itr += num_points + 1
        
    def get_cal_steps(self, dc: bool=True, ac_serv: bool=False, ac: bool=True, lin: bool=False, gain: bool=True, flat: bool=True):
        """Query cal steps from 5790B"""
        test_points = []
        if dc: self._parse_cal_steps("cal_dc? input1", test_points)
        if ac_serv:
            self._parse_cal_steps("cal_i2?", test_points)
            test_points.append({ 'range': 2.2, 'nominal': 2.0, 'frequency': 1000, 'function': TEST_POINT_TYPE_5790B.SERVICE, 'spec': 100.2 })
        if ac: self._parse_cal_steps("cal_ac? input1", test_points)
        if lin: self._parse_cal_steps("cal_wblin?", test_points)
        if gain: self._parse_cal_steps("cal_dc? wbnd", test_points)
        if flat: self._parse_cal_steps("cal_ac? wbnd", test_points)
        return test_points

    def set_filters(self, mode: DFILT_5790B_MODE, restart: DFILT_5790B_RESTART, verbose=False):
        message = f"DFILT {mode.name},{restart.name}"
        self.resource.write(message)
        if verbose: print(message)
    
    def get_filters(self) -> str: return self.resource.query("DFILT?")
    def set_hires(self, mode: bool): self.resource.write(f"HIRES {int(mode)}")
    def get_hires(self): return bool(int(self.resouce.query("HIRES?")))
    def set_extguard(self, enabled: bool): self.resource.write(f"EXTGUARD {'ON' if enabled else 'OFF'};*CLS")

    def send_VAL(self):
        """Query the "VAL?" command to the 5790B."""
        output = self.resource.query("VAL?").strip()
        output = output.split(',')
        return float(output[0]), float(output[1]), MEASUREMENT_STATUS_5790B(int(output[2]))

    def send_MEAS(self):
        """Query the "MEAS?" command to the 5790B."""
        output = self.resource.query("MEAS?").strip()
        output = output.split(',')
        return float(output[0]), float(output[1]), MEASUREMENT_STATUS_5790B(int(output[2]))
    
    def set_auto_range(self): 
        self.resource.write("RANGE AUTO")

    def set_input(self, input_name: str):
        input_name = str(input_name or "INPUT2").strip().upper()
        if input_name not in self.VALID_INPUTS:
            raise ValueError("5790 input must be INPUT1 or INPUT2")
        self.resource.write(f"INPUT {input_name}")
        self.active_input = input_name

    def configure_acquisition(
        self,
        *,
        filter_mode="FAST",
        filter_restart="COARSE",
        hires=False,
        hires_enabled=None,
        range_mode="POINT",
        point_value=None,
        input_switch_delay=1.0,
    ):
        """Apply the operator-selected 5790A/B reading profile.

        The Alpha and Bravo share this command surface.  ``POINT`` locks the
        range from the current test-point drive; ``AUTO`` leaves autoranging
        enabled.  Slow digital filtering can take more than 60 seconds below
        200 Hz, so the VISA timeout is raised to avoid a false timeout.
        """
        mode = str(filter_mode or "FAST").strip().upper()
        restart = str(filter_restart or "COARSE").strip().upper()
        range_mode = str(range_mode or "POINT").strip().upper()
        if mode not in self.VALID_FILTER_MODES:
            raise ValueError("5790 filter mode must be OFF, FAST, MEDIUM, or SLOW")
        if restart not in self.VALID_FILTER_RESTARTS:
            raise ValueError("5790 filter restart must be FINE, MEDIUM, or COARSE")
        if range_mode not in {"AUTO", "POINT"}:
            raise ValueError("5790 range mode must be AUTO or POINT")

        if mode == "OFF":
            self.resource.write("DFILT OFF")
        else:
            self.resource.write(f"DFILT {mode},{restart}")
        # ``f5790_hires_enabled`` is the persisted API field.  Accept that
        # spelling directly while preserving ``hires`` for existing callers.
        # This prevents a settings payload from failing at the start of a run
        # merely because the UI/API and driver used different keyword names.
        if hires_enabled is not None:
            hires = hires_enabled
        self.set_hires(bool(hires))
        if range_mode == "AUTO":
            self.set_auto_range()
        elif point_value is not None:
            self.set_range(abs(float(point_value)))

        delay = float(input_switch_delay or 0)
        if delay < 0 or delay > 300:
            raise ValueError("5790 input-switch delay must be between 0 and 300 seconds")
        self.input_switch_delay = delay
        if hasattr(self.resource, "timeout"):
            minimum_timeout = 130000 if mode == "SLOW" else (90000 if mode == "MEDIUM" else 60000)
            self.resource.timeout = max(float(self.resource.timeout or 0), minimum_timeout)

    def read_input(self, input_name: str):
        """Select one main input, allow it to settle, then take a fresh read."""
        input_name = str(input_name or "INPUT2").strip().upper()
        changed = getattr(self, "active_input", None) != input_name
        if changed:
            self.set_input(input_name)
            if self.input_switch_delay:
                time.sleep(self.input_switch_delay)
        return self.read_instrument()
        
    def set_range(self, value: float):
        self.resource.write(f"RANGE {value}")

    def get_range(self):
        response = self.resource.query("RANGE?").strip().split(',')
        return float(response[0]), float(response[1]), float(response[2]), int(response[3])
    
    def reset(self): self.resource.write("*RST")
    def enter_cal_menu(self, testpoint_type:int):
        calibration_commands = {
            0: "cal_dc input1", 1: "cal_i2", 2: "cal_ac? input1",
            3: "cal_wblin", 4: "cal_dc? wbnd", 5: "cal_ac? wbnd",
        }
        if testpoint_type in calibration_commands: self.resource.write(calibration_commands[testpoint_type])
        else: print(f"Unknown testpoint_type: {testpoint_type}") 
    
    def input_wb(self): self.resource.write("INPUT WBND")
    def wait(self): self.resource.write("*WAI")
    def clear_status(self): self.resource.write("*CLS")
    def start_adjust(self, correction_voltage: float): self.resource.write(f"*OPC;CAL_NEXT {correction_voltage}")
    def start_freq_cal(self, frequency: float): self.resource.write(f"*OPC;CAL_FREQ INPUT1, {frequency}")
    def check_adjust_complete(self) -> bool: return self.resource.query("*OPC?") == "1"
    def get_cal_next(self) -> str: return self.resource.query("CAL_NEXT?")
    def cal_skip(self) -> str: return self.resource.write("CAL_SKIP")
    def get_error_status(self) -> str: return self.resource.query("ERR?")
    def secure_off(self) -> str: return self.resource.write('CAL_SECURE OFF, "5790"')
    def secure_on(self) -> str: return self.resource.write('CAL_SECURE ON, "5790"')
    
    def ranges_updated(self, query: int) -> str:
        cal_commands = {
            TEST_POINT_TYPE_5790B.DC: "CAL_STORE? DC", TEST_POINT_TYPE_5790B.SERVICE: "CAL_STORE? ALL",
            TEST_POINT_TYPE_5790B.AC: "CAL_STORE? AC", TEST_POINT_TYPE_5790B.LIN: "CAL_STORE? ALL",
            TEST_POINT_TYPE_5790B.GAIN: "CAL_STORE? WDC", TEST_POINT_TYPE_5790B.FLAT: "CAL_STORE? WAC",
        }
        if query in cal_commands: return self.resource.query(cal_commands[query])
        else: return f"Invalid cal type: {query}"
        
    def store_constants(self, query: int) -> str:
        cal_types = {
            "CAL_STORE DC": TEST_POINT_TYPE_5790B.DC, "CAL_STORE ALL": TEST_POINT_TYPE_5790B.SERVICE,
            "CAL_STORE AC": TEST_POINT_TYPE_5790B.AC, "CAL_STORE ALL": TEST_POINT_TYPE_5790B.LIN,
            "CAL_STORE WDC": TEST_POINT_TYPE_5790B.GAIN, "CAL_STORE WAC": TEST_POINT_TYPE_5790B.FLAT,
        }
        key_name = next((key for key, value in cal_types.items() if value == query), None)
        if key_name: return self.resource.write(key_name)
        else: return f"Invalid cal type: {key_name}"

    def cal_off(self): self.resource.write("CAL_OFF")
    def secure_off_service_code(self, service_code: int) -> str: return self.resource.write(f'CAL_SECURE OFF, "{service_code}"')
    def input_cal(self, input: int): self.resource.write(f"INPUT INPUT{input}")
    def get_instrument_status(self):
        isr = bin(int(self.resource.query('ISR?'))).replace('0b', '')
        return isr.zfill(16)
