# instrument_11713C.py

import pyvisa
import time

# This is the single channel on the 11713C that will control the relay coil.
RELAY_CONTROL_CHANNEL = 109

class Instrument11713C():
    """11713C Switch Driver Instrument class, configured for a single SPDT relay."""
    def __init__(self, gpib: str, timeout: float = 10000):
        self.rm = pyvisa.ResourceManager()
        self.resource = self.rm.open_resource(gpib)
        self.resource.timeout = timeout
        self.resource.read_termination = '\n'
        
        # --- Configure and verify 24V supply on connection ---
        try:
            self.resource.write("CONFigure:BANK1 P24v")
            time.sleep(0.1) 
            response = self.resource.query("CONFigure:BANK1?").strip()
            if 'P24' not in response:
                raise ConnectionError("Failed to set 11713C Bank 1 supply voltage to 24V.")
            print("11713C Bank 1 supply confirmed at 24V.")
        except Exception as e:
            raise ConnectionError(f"Error configuring 11713C supply voltage: {e}")

    def select_dc_source(self):
        """Selects the DC source by ENERGIZING the relay (closing the path to the NO contact)."""
        self.resource.write(f"ROUT:CLOS (@{RELAY_CONTROL_CHANNEL})")

    def select_ac_source(self):
        """Selects the AC source by DE-ENERGIZING the relay (opening the path, returning to the NC contact)."""
        self.resource.write(f"ROUT:OPEN (@{RELAY_CONTROL_CHANNEL})")

    def deactivate_all(self):
        """Deactivates the relay, which defaults to the AC source (de-energized, NC state)."""
        self.select_ac_source()
        
    def get_active_source(self):
        """Queries the single relay channel to determine which source is active."""
        try:
            is_relay_energized = int(self.resource.query(f"ROUT:CLOS? (@{RELAY_CONTROL_CHANNEL})"))
            if is_relay_energized:
                return 'DC'
            else:
                return 'AC'
        except Exception as e:
            print(f"Could not determine active source: {e}")
            return 'Unknown'