# Fluke 8508A AC Shunt integration

## Manual findings

The implementation is based on the supplied Fluke 8508A Users Manual
(`8508A___umeng0600`) and Service Manual (`8508a___smeng0200`).

- The base 8508A has front terminals only. Front and rear terminals require
  the **8508A/01** option (Users Manual PDF page 29 and `*OPT?` on page 123).
- The documented ACV reset defaults are
  `ACV AUTO,FILT40HZ,RESL6,TFER_ON,TWO_WR` (pages 89-90).
  The application configures its own per-stage profile as described below.
- `INPUT FRONT` and `INPUT REAR` select one terminal set (page 99).
- The three scan commands are sequential calculations:
  - `INPUT DIV_REAR`: Front / Rear
  - `INPUT SUB_REAR`: Front - Rear
  - `INPUT DEVTN`: (Front - Rear) / Rear
- None of those scan commands exposes the two underlying raw readings.
- `X?` is the high-speed trigger-and-read query. It is equivalent to
  `*TRG;RDG?` (page 112).
- `TRG_SRCE EXT` plus `DELAY DFLT` applies the meter's default settling delay
  to controller-generated readings (pages 111-113). The application currently
  uses internal triggering and explicit waits before `RDG?`.
- The nominal 2 V ranges end at 1.99990000 V. A numeric expected-signal
  command of `2` therefore selects the 20 V range rather than the 2 V range
  (Users Manual pages 89-90 and specification note 15 on page 144).
- Table 4-2 gives longer ACV delays for front/rear scanning than for normal
  readings. For example, 10 Hz/RESL6 is 2.5 s normally and 12.5 s while
  scanning. The stage settings use scan and DC profile delays to recommend
  the FRONT/REAR settling time; a saved operator override is retained.

## Acquisition design

The 8508A has one measurement engine, so front and rear cannot produce truly
simultaneous independent readings. The AC Shunt integration therefore models
one 8508A/01 as:

1. One shared VISA connection.
2. A Standard logical reader bound to Front or Rear.
3. A TI logical reader bound to the opposite terminal.
4. One atomic, serialized pair operation:
   - select the first terminal;
   - wait for the configured input-switch settling time and issue `RDG?`;
   - select the second terminal;
   - wait for the configured input-switch settling time and issue `RDG?`.
5. Alternating pair order on successive samples:
   Standard-TI, then TI-Standard.

The alternating A-B / B-A sequence reduces first/second-channel drift bias
while retaining the same `(standard, ti)` return order expected by the
existing collection and stability pipeline.

## Current acquisition profile

The driver starts in `DCV 0.1,FILT_ON,RESL7,FAST_OFF,TWO_WR` with `TRG_SRCE INT`.
For direct Y5020 acquisition, `_configure_8508_for_y5020` in
[`consumers.py`](../Backend/ac_shunt/api/consumers.py) applies the selected AC or DC
profile and expected signal range before each stage. AC filter, resolution,
transfer and coupling choices and DC filter, resolution and fast-mode choices
come from the saved settings, with validated defaults.

Internal triggering uses completed `RDG?` readings. After switching terminals,
the driver waits for the configured settling time. After changing a measurement
profile without a terminal switch, it discards a completed reading under the new
profile and waits for the next conversion before saving. The driver retains an
external-trigger `X?` path for callers selecting that mode; it is not the current
Y5020 stage configuration.

The [driver](../Backend/ac_shunt/api/NPSL_Tools/npsl_tools/instruments/instrument_8508A.py)
exposes the programmed profile through `get_acquisition_profile()` for run auditing.
Focused checks live in `api.test_8508_stage_configuration` and
`NPSL_Tools/tests/test_8508A_unit.py`. These software checks do not establish
physical-instrument timing or accuracy.

## Safety and validation

- Rear assignment is rejected unless `*OPT?` reports `8508A/01`.
- A session cannot bind Standard and TI to the same terminal of one 8508A.
- All I/O is protected by a process-wide lock keyed by VISA address, so the
  existing asynchronous collector cannot interleave channel selection and
  trigger commands.
- Overload (`±200E+33`) is rejected instead of entering the readings arrays.
- Generic `write_command` and `query_command` methods expose the complete
  programming-command surface from the manual, while typed helpers cover the
  AC Shunt initialization, function, input, scan, trigger, delay, and reading
  operations.
