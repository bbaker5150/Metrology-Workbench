# Fluke 8508A AC Shunt integration

## Manual findings

The implementation is based on the supplied Fluke 8508A Users Manual
(`8508A___umeng0600`) and Service Manual (`8508a___smeng0200`).

- The base 8508A has front terminals only. Front and rear terminals require
  the **8508A/01** option (Users Manual PDF page 29 and `*OPT?` on page 123).
- AC-voltage initialization is explicitly:
  `ACV AUTO,FILT40HZ,RESL6,TFER_ON,TWO_WR`.
  These are also the documented ACV reset defaults (pages 89-90).
- `INPUT FRONT` and `INPUT REAR` select one terminal set (page 99).
- The three scan commands are sequential calculations:
  - `INPUT DIV_REAR`: Front / Rear
  - `INPUT SUB_REAR`: Front - Rear
  - `INPUT DEVTN`: (Front - Rear) / Rear
- None of those scan commands exposes the two underlying raw readings.
- `X?` is the high-speed trigger-and-read query. It is equivalent to
  `*TRG;RDG?` (page 112).
- `TRG_SRCE EXT` plus `DELAY DFLT` applies the meter's default settling delay
  to controller-generated readings (pages 111-113).

## Acquisition design

The 8508A has one measurement engine, so front and rear cannot produce truly
simultaneous independent readings. The AC Shunt integration therefore models
one 8508A/01 as:

1. One shared VISA connection.
2. A Standard logical reader bound to Front or Rear.
3. A TI logical reader bound to the opposite terminal.
4. One atomic, serialized pair operation:
   - select the first terminal;
   - issue `X?`;
   - select the second terminal;
   - issue `X?`.
5. Alternating pair order on successive samples:
   Standard-TI, then TI-Standard.

The alternating A-B / B-A sequence reduces first/second-channel drift bias
while retaining the same `(standard, ti)` return order expected by the
existing collection and stability pipeline.

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

