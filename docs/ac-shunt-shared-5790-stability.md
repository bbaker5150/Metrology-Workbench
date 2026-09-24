# Shared 5790 initial stability gate

A shared 5790A/B now searches for initial stability independently on each
physical input, without repeating the complete Standard/TI acquisition.
The Standard input stays selected until its initial window passes and its
requested sample count is complete, then the TI input follows the same process.

For 35 samples, a 30-reading window and a 3 ppm limit:

- Fill 30 readings on the selected input and compare sample standard deviation
  divided by the absolute mean (in ppm) with the limit; passing requires <3 ppm.
- On failure, increment the stage's retry count, discard the oldest reading on
  the next acquisition and evaluate the next 30-reading window.
- On success, retain that window and collect five more readings. Do not restart
  or switch inputs between failed windows.
- If the retry limit is exhausted on either input, fail the stage and do not
  save a partial Standard/TI result or advance to the next source phase.

“Bypass stability attempts (post initial)” still requires the initial search in
cycle one. After that lock it suppresses instability retries, and later cycles
skip the initial search. With bypass off, each cycle requires its initial search
and post-lock unstable windows count toward the same stage retry limit.

Each acquired reading updates the live charts immediately. During search, the
snapshot contains exactly the current candidate window; after lock it contains
the retained readings. While TI is searching, the completed Standard readings
remain visible. Reconnecting viewers receive the current role's progress.

Regression coverage in `api.test_5790a_reader_routing` exercises both reader
models, the 3/35/30 configuration, independent input searches, retained windows,
retry exhaustion on either input, post-lock failure on the final sample,
first-cycle versus later-cycle bypass, Stop, and reconnect progress. These are
simulated instrument tests; physical bench validation is still required.
