import pyvisa

class Instrument8100:
    """
    Instrument class for the Clarke-Hess Model 8100 Transconductance Amplifier.
    """
    # Mapping of full-scale range values to their SCPI commands
    RANGE_COMMANDS = {
        0.002: 'R0',  # 2mA Range
        0.02:  'R1',  # 20mA Range
        0.2:   'R2',  # 0.2A Range
        2:     'R3',  # 2A Range
        20:    'R4',  # 20A Range
        100:   'R5',  # 100A Range
    }

    def __init__(self, model: str, gpib: str, timeout: int = 20000, reset_on_connect: bool = True):
        """
        Initializes and connects to the instrument.

        Args:
            model (str): The model number of the instrument (e.g., "8100").
            gpib (str): The GPIB address string for the instrument.
            timeout (int): The VISA communication timeout in milliseconds.
        """
        self.model = model
        self.gpib = gpib
        self.rm = pyvisa.ResourceManager()
        self.resource = self.rm.open_resource(gpib)
        self.resource.timeout = timeout
        self.resource.read_termination = '\n'
        if reset_on_connect:
            self.reset()

    def close(self, reset: bool = True):
        """Closes the VISA resource connection."""
        if reset:
            self.resource.write('*RST')
        if self.resource:
            self.resource.close()

    def get_identity(self):
        """Queries the instrument's identification string."""
        return self.resource.query('*IDN?')

    def reset(self):
        """Resets the instrument to its power-on state."""
        self.resource.write('*RST')

    def clear(self):
        """Resets the instrument to its power-on state."""
        self.resource.write('*CLS')

    def initialize(self):
        """Initialize"""
        self.resource.write("*CLS;DCl;SB;R0")

    def set_range(self, range_amps: float):
        """
        Sets the output current range of the amplifier.

        Note: Changing the range automatically places the instrument in standby mode. [cite: 187]

        Args:
            range_amps (float): The desired full-scale range in Amps (e.g., 20, 0.2, 0.002).
        
        Raises:
            ValueError: If the specified range is not a valid, supported value.
        """
        command = self.RANGE_COMMANDS.get(range_amps)
        if command:
            self.resource.write(command)
        else:
            valid_ranges = ", ".join(map(str, sorted(self.RANGE_COMMANDS.keys())))
            raise ValueError(f"Invalid range '{range_amps}A'. Valid ranges are: {valid_ranges}.")

    def set_operate(self):
        """Puts the instrument in OPERATE mode, activating the current output. [cite: 719, 220]"""
        self.resource.write('OP')

    def set_standby(self):
        """Puts the instrument in STANDBY mode, deactivating the current output. [cite: 718, 212]"""
        self.resource.write('SB')

    def check_errors(self):
        """
        Reads the Standard Event Status Register to check for errors.
        The Model 8100 uses status bits, not a SYST:ERR? queue.
        Returns:
            int: The integer value of the event status register. A value of 0 means no errors.
        """
        esr = int(self.resource.query("*ESR?"))
        if esr != 0:
            print(f"Warning: Instrument {self.model} event status register is non-zero: {esr}")
        return esr
