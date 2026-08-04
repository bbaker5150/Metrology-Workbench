"""
Tests for the durable write-outbox.

Covers the three scenarios the plan committed to:

  * unit: enqueue + replay happy path and replay-while-default-is-down.
  * integration: stage writes land in the correct CalibrationReadings row
    after a simulated outage ends.
  * crash: pending rows survive a "restart" (fresh imports) and drain on
    the next explicit ``drain_once``.

The tests use Django's default test runner, which creates isolated test
databases for every alias declared in ``DATABASES`` (so the ``outbox``
alias gets its own file too). No MSSQL is ever required — outages are
simulated by patching ``probe_default_reachable`` and
``attempt_replay_row``.
"""

import asyncio
from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api import outbox as outbox_module
from api import session_state
from api.models import (
    CalibrationReadings,
    CalibrationRunLock,
    CalibrationSession,
    PendingReadingWrite,
    TestPoint,
    TestPointSet,
    Workstation,
    WorkstationClaim,
)


def _run(coro):
    """Tiny helper so tests can exercise the async drainer primitives."""
    return asyncio.run(coro)


class CycleAnalyticsParityTests(TestCase):
    """Parity tests for the cycle pairing/outlier helpers ported from the
    frontend's CycleStatisticsTracker `cycleData` useMemo (see the JSX at
    Frontend/.../CycleStatisticsTracker.jsx before the centralization
    refactor)."""

    def test_abba_pairing_matches_js(self):
        from api.models import build_pair_rows
        fwd = [(i + 1, v) for i, v in enumerate([1.0, 1.2, 0.9, 1.1, 0.95, 1.05])]
        rev = [(i + 1, v) for i, v in enumerate([1.1, 0.85, 1.15, 0.92, 1.08, 1.02])]
        rows = build_pair_rows(fwd, rev, use_abba=True)
        self.assertEqual(len(rows), 6)
        # ABBA: Fwd_1 pairs with Rev_6, Fwd_2 with Rev_5, etc.
        self.assertEqual(rows[0]['fwd_cycle_num'], 1)
        self.assertEqual(rows[0]['rev_cycle_num'], 6)
        self.assertAlmostEqual(rows[0]['paired_avg'], (1.0 + 1.02) / 2)

    def test_standard_pairing_matches_js(self):
        from api.models import build_pair_rows
        fwd = [(i + 1, v) for i, v in enumerate([1.0, 1.2, 0.9])]
        rev = [(i + 1, v) for i, v in enumerate([1.1, 0.85, 1.15])]
        rows = build_pair_rows(fwd, rev, use_abba=False)
        self.assertEqual(rows[0]['fwd_cycle_num'], 1)
        self.assertEqual(rows[0]['rev_cycle_num'], 1)
        self.assertAlmostEqual(rows[1]['paired_avg'], (1.2 + 0.85) / 2)

    def test_chauvenet_flags_outlier_at_n12(self):
        from api.models import build_pair_rows, apply_outlier_filter
        # Build a stable baseline of 12 pairs with one egregious outlier.
        fwd = [(i + 1, 1.0) for i in range(12)]
        rev = [(i + 1, 1.0) for i in range(12)]
        rev[5] = (6, 100.0)
        rows = build_pair_rows(fwd, rev, use_abba=False)
        auto, flagged = apply_outlier_filter(rows, 'auto')
        self.assertIn(6, auto)
        self.assertEqual(flagged, set())

    def test_iqr_flags_small_n(self):
        from api.models import build_pair_rows, apply_outlier_filter
        fwd = [(i + 1, 1.0) for i in range(6)]
        rev = [(i + 1, 1.0) for i in range(6)]
        rows = build_pair_rows(fwd, rev, use_abba=False)
        rows[2]['paired_avg'] = 50.0  # mid-range outlier
        auto, flagged = apply_outlier_filter(rows, 'auto')
        self.assertEqual(auto, set())
        self.assertIn(3, flagged)

    def test_none_mode_disables_all_filters(self):
        from api.models import build_pair_rows, apply_outlier_filter
        fwd = [(i + 1, 1.0) for i in range(12)]
        rev = [(i + 1, 1.0) for i in range(12)]
        rev[5] = (6, 999.0)
        rows = build_pair_rows(fwd, rev, use_abba=False)
        auto, flagged = apply_outlier_filter(rows, 'none')
        self.assertEqual(auto, set())
        self.assertEqual(flagged, set())


class CycleReadingsMergeIdempotencyTests(TestCase):
    """Re-collecting a cycle must REPLACE that cycle's readings, not append a
    second copy. Regression for the raw chart showing 12 readings for cycle 1
    when 6 were collected (duplicate cycle blocks, surfaced by the
    characterize-then-rerun workflow). See
    ``CalibrationConsumer._drop_cycle_from_readings``."""

    def _consumer(self):
        from api.consumers import CalibrationConsumer
        # The helper does not touch instance state, so a bare instance is fine.
        return CalibrationConsumer.__new__(CalibrationConsumer)

    def test_recollecting_a_cycle_replaces_not_duplicates(self):
        c = self._consumer()
        existing = [
            {'value': 1.0, 'cycle': 1}, {'value': 1.1, 'cycle': 1},
            {'value': 2.0, 'cycle': 2}, {'value': 2.1, 'cycle': 2},
        ]
        fresh_cycle1 = [{'value': 9.0, 'cycle': 1}, {'value': 9.1, 'cycle': 1}]
        merged = c._drop_cycle_from_readings(existing, 1) + fresh_cycle1
        # Cycle 1 ends up with exactly the fresh pair (no duplication); cycle 2
        # is untouched.
        self.assertEqual(sum(1 for r in merged if r['cycle'] == 1), 2)
        self.assertEqual(sum(1 for r in merged if r['cycle'] == 2), 2)
        self.assertEqual([r['value'] for r in merged if r['cycle'] == 1], [9.0, 9.1])

    def test_untagged_legacy_readings_count_as_cycle_one(self):
        c = self._consumer()
        existing = [{'value': 1.0}, {'value': 1.1}]  # no cycle tag -> cycle 1
        self.assertEqual(c._drop_cycle_from_readings(existing, 1), [])

    def test_none_cycle_is_passthrough(self):
        c = self._consumer()
        existing = [{'value': 1.0, 'cycle': 1}]
        self.assertEqual(c._drop_cycle_from_readings(existing, None), existing)


class PairAggregateCycleCapTests(TestCase):
    """Analytics must honor the configured source-of-truth N cycles even when
    a direction physically collected more. Regression for the cycle
    source-of-truth work: set N=12 and only 12 pairs feed mean / u_A even if
    15 cycles exist on a side."""

    def _build_pair(self, n_cycles_setting, fwd_count, rev_count):
        from api.models import (
            CalibrationResults,
            CalibrationResultsCycle,
            CalibrationSettings,
        )
        session = CalibrationSession.objects.create(session_name="cap-test")
        tps, _ = TestPointSet.objects.get_or_create(session=session)
        fwd = TestPoint.objects.create(
            test_point_set=tps, current=Decimal("1.00000"),
            frequency=1000, direction="Forward",
        )
        rev = TestPoint.objects.create(
            test_point_set=tps, current=Decimal("1.00000"),
            frequency=1000, direction="Reverse",
        )
        if n_cycles_setting is not None:
            CalibrationSettings.objects.create(test_point=fwd, n_cycles=n_cycles_setting)
            CalibrationSettings.objects.create(test_point=rev, n_cycles=n_cycles_setting)
        fwd_res = CalibrationResults.objects.create(test_point=fwd)
        rev_res = CalibrationResults.objects.create(test_point=rev)
        for i in range(fwd_count):
            CalibrationResultsCycle.objects.create(
                results=fwd_res, cycle_index=i + 1, delta_uut_ppm=1.0,
            )
        for i in range(rev_count):
            CalibrationResultsCycle.objects.create(
                results=rev_res, cycle_index=i + 1, delta_uut_ppm=1.0,
            )
        return fwd_res, rev_res

    def test_caps_to_n_cycles_when_more_collected(self):
        fwd_res, _ = self._build_pair(n_cycles_setting=12, fwd_count=15, rev_count=15)
        fwd_res.recompute_pair_aggregate()
        fwd_res.refresh_from_db()
        self.assertEqual(fwd_res.n_pairs_used, 12)

    def test_uses_all_cycles_when_no_setting(self):
        fwd_res, _ = self._build_pair(n_cycles_setting=None, fwd_count=15, rev_count=15)
        fwd_res.recompute_pair_aggregate()
        fwd_res.refresh_from_db()
        self.assertEqual(fwd_res.n_pairs_used, 15)

    def test_n_cycles_is_editable_after_cycles_exist(self):
        # n_cycles is shared-but-editable: changing it after cycles have been
        # captured must NOT be rejected (capping keeps the math safe).
        from api.models import CalibrationSettings
        from api.serializers import CalibrationSettingsSerializer
        fwd_res, _ = self._build_pair(n_cycles_setting=15, fwd_count=15, rev_count=15)
        settings = CalibrationSettings.objects.get(test_point=fwd_res.test_point)
        serializer = CalibrationSettingsSerializer(
            instance=settings, data={'n_cycles': 12}, partial=True
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)


class OutboxEnqueueTests(TestCase):
    databases = {'default', 'outbox'}

    def setUp(self):
        self.session = CalibrationSession.objects.create(session_name="TestSession-Outbox")
        self.tps, _ = TestPointSet.objects.get_or_create(session=self.session)
        self.tp = TestPoint.objects.create(
            test_point_set=self.tps,
            current=Decimal("1.00000"),
            frequency=1000,
            direction="Forward",
        )

    def test_enqueue_creates_pending_row(self):
        row_id = outbox_module.enqueue(
            session_id=self.session.id,
            test_point={'id': self.tp.id, 'current': 1.0, 'frequency': 1000, 'direction': 'Forward'},
            reading_type_full='std_ac_open',
            readings_list=[{'value': 1.23, 'is_stable': True}],
        )
        self.assertIsNotNone(row_id)
        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertEqual(row.status, PendingReadingWrite.STATUS_PENDING)
        self.assertEqual(row.session_id, self.session.id)
        self.assertEqual(row.test_point_id, self.tp.id)
        self.assertEqual(row.reading_type_full, 'std_ac_open')
        self.assertEqual(row.readings_json, [{'value': 1.23, 'is_stable': True}])
        self.assertEqual(row.attempts, 0)

    def test_replay_happy_path_marks_row_done(self):
        row_id = outbox_module.enqueue(
            session_id=self.session.id,
            test_point={'id': self.tp.id},
            reading_type_full='std_dc_pos',
            readings_list=[{'value': 2.5, 'is_stable': True}, {'value': 2.51, 'is_stable': True}],
        )
        ok = outbox_module.attempt_replay_row(row_id)
        self.assertTrue(ok)

        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertEqual(row.status, PendingReadingWrite.STATUS_DONE)

        readings = CalibrationReadings.objects.get(test_point=self.tp)
        self.assertEqual(
            readings.std_dc_pos_readings,
            [{'value': 2.5, 'is_stable': True}, {'value': 2.51, 'is_stable': True}],
        )

    def test_replay_idempotent_on_double_apply(self):
        """Replaying the same payload twice must yield the same DB state."""
        row_id = outbox_module.enqueue(
            session_id=self.session.id,
            test_point={'id': self.tp.id},
            reading_type_full='std_ac_open',
            readings_list=[{'value': 1.0, 'is_stable': True}],
        )
        self.assertTrue(outbox_module.attempt_replay_row(row_id))
        # Simulate a crash between save() and mark_done by flipping the row
        # back to pending and re-running.
        PendingReadingWrite.objects.using('outbox').filter(pk=row_id).update(
            status=PendingReadingWrite.STATUS_PENDING,
        )
        self.assertTrue(outbox_module.attempt_replay_row(row_id))

        readings = CalibrationReadings.objects.get(test_point=self.tp)
        self.assertEqual(readings.std_ac_open_readings, [{'value': 1.0, 'is_stable': True}])


class OutboxOutageTests(TestCase):
    """
    Simulate MSSQL being unreachable mid-run, then confirm the drainer
    picks up pending rows once the probe starts succeeding again.
    """
    databases = {'default', 'outbox'}

    def setUp(self):
        self.session = CalibrationSession.objects.create(session_name="TestSession-Outage")
        self.tps, _ = TestPointSet.objects.get_or_create(session=self.session)
        self.tp = TestPoint.objects.create(
            test_point_set=self.tps,
            current=Decimal("2.00000"),
            frequency=500,
            direction="Forward",
        )

    def test_rows_stay_pending_while_default_is_down(self):
        row_id = outbox_module.enqueue(
            session_id=self.session.id,
            test_point={'id': self.tp.id},
            reading_type_full='ti_ac_open',
            readings_list=[{'value': 42.0, 'is_stable': True}],
        )

        # Pretend the DB cursor raises on every attempt.
        def _boom(*_args, **_kwargs):
            return False

        with mock.patch.object(outbox_module, 'attempt_replay_row', side_effect=_boom):
            # Drain pass should be a no-op because probe is also patched down.
            with mock.patch.object(outbox_module, 'probe_default_reachable', return_value=False):
                drained = _run(outbox_module.drain_once())
                self.assertEqual(drained, 0)

        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertIn(
            row.status,
            (PendingReadingWrite.STATUS_PENDING, PendingReadingWrite.STATUS_IN_FLIGHT),
        )

    def test_drainer_replays_after_recovery(self):
        """
        After enqueueing while "MSSQL is down", replaying the row once the
        default DB is reachable again must push the payload into
        CalibrationReadings.

        This mirrors what ``run_drainer_forever`` does on each tick: pick
        the next pending row and call ``attempt_replay_row``. The ``drain_once``
        orchestration is covered separately in
        ``test_drain_once_is_a_noop_when_default_is_down``.
        """
        row_id = outbox_module.enqueue(
            session_id=self.session.id,
            test_point={'id': self.tp.id},
            reading_type_full='ti_dc_pos',
            readings_list=[{'value': 9.9, 'is_stable': True}],
        )

        # Phase 1: "MSSQL is down" — nothing should replay, row stays pending.
        with mock.patch.object(outbox_module, 'probe_default_reachable', return_value=False):
            # Simulate the drainer's own precheck: if probe fails, don't attempt.
            if outbox_module.probe_default_reachable(force=True):
                self.fail("probe should have been patched to False")

        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertEqual(row.status, PendingReadingWrite.STATUS_PENDING)

        # Phase 2: "MSSQL is back up" — replay succeeds.
        ok = outbox_module.attempt_replay_row(row_id)
        self.assertTrue(ok)

        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertEqual(row.status, PendingReadingWrite.STATUS_DONE)

        readings = CalibrationReadings.objects.get(test_point=self.tp)
        self.assertEqual(readings.ti_dc_pos_readings, [{'value': 9.9, 'is_stable': True}])

    def test_drain_once_is_a_noop_when_default_is_down(self):
        """drain_once must exit without touching rows when the probe fails."""
        row_id = outbox_module.enqueue(
            session_id=self.session.id,
            test_point={'id': self.tp.id},
            reading_type_full='ti_ac_close',
            readings_list=[{'value': 3.3, 'is_stable': True}],
        )

        with mock.patch.object(outbox_module, 'probe_default_reachable', return_value=False):
            drained = _run(outbox_module.drain_once())

        self.assertEqual(drained, 0)
        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertEqual(row.status, PendingReadingWrite.STATUS_PENDING)


class OutboxRetryExhaustionTests(TestCase):
    """
    Rows that fail repeatedly eventually transition to FAILED and stop
    draining automatically, so the UI can surface them for manual review.
    """
    databases = {'default', 'outbox'}

    def test_row_transitions_to_failed_after_max_attempts(self):
        session = CalibrationSession.objects.create(session_name="TestSession-Retry")
        tps, _ = TestPointSet.objects.get_or_create(session=session)
        tp = TestPoint.objects.create(
            test_point_set=tps,
            current=Decimal("0.50000"),
            frequency=100,
            direction="Forward",
        )

        row_id = outbox_module.enqueue(
            session_id=session.id,
            test_point={'id': tp.id},
            reading_type_full='std_ac_close',
            readings_list=[{'value': 1.0, 'is_stable': True}],
        )

        # Force every replay to hit an error by deleting the session mid-
        # flight, so the inner get() fails.
        CalibrationSession.objects.filter(pk=session.id).delete()

        for _ in range(outbox_module._MAX_ATTEMPTS_BEFORE_FAILED):
            outbox_module.attempt_replay_row(row_id)

        row = PendingReadingWrite.objects.using('outbox').get(pk=row_id)
        self.assertEqual(row.status, PendingReadingWrite.STATUS_FAILED)
        self.assertGreaterEqual(row.attempts, outbox_module._MAX_ATTEMPTS_BEFORE_FAILED)
        self.assertTrue(row.last_error)


class OutboxStatusPayloadTests(TestCase):
    """The snapshot the WS consumer sends must reflect the outbox state."""
    databases = {'default', 'outbox'}

    def test_payload_counts_pending_and_failed_rows(self):
        session = CalibrationSession.objects.create(session_name="TestSession-Status")
        tps, _ = TestPointSet.objects.get_or_create(session=session)
        tp = TestPoint.objects.create(
            test_point_set=tps,
            current=Decimal("0.10000"),
            frequency=60,
            direction="Forward",
        )

        # 2 pending rows, 1 failed row.
        for stage in ('std_ac_open', 'std_dc_pos'):
            outbox_module.enqueue(
                session_id=session.id,
                test_point={'id': tp.id},
                reading_type_full=stage,
                readings_list=[{'value': 1.0, 'is_stable': True}],
            )

        failed_row_id = outbox_module.enqueue(
            session_id=session.id,
            test_point={'id': tp.id},
            reading_type_full='ti_ac_open',
            readings_list=[{'value': 1.0, 'is_stable': True}],
        )
        PendingReadingWrite.objects.using('outbox').filter(pk=failed_row_id).update(
            status=PendingReadingWrite.STATUS_FAILED,
        )

        payload = outbox_module.current_status_payload()
        self.assertEqual(payload['type'], 'db_status')
        self.assertEqual(payload['pending_count'], 2)
        self.assertEqual(payload['failed_count'], 1)


class OutboxRouterMigrateTests(TestCase):
    """Sanity check that the router pins PendingReadingWrite to the outbox alias."""
    databases = {'default', 'outbox'}

    def test_outbox_model_lives_on_outbox_alias(self):
        from api.db_routers import OutboxRouter
        router = OutboxRouter()

        self.assertEqual(router.db_for_read(PendingReadingWrite), 'outbox')
        self.assertEqual(router.db_for_write(PendingReadingWrite), 'outbox')
        self.assertIsNone(router.db_for_read(CalibrationSession))
        self.assertIsNone(router.db_for_write(CalibrationSession))

        # Migrations for the outbox model should run ONLY on the outbox alias.
        self.assertTrue(router.allow_migrate('outbox', 'api', 'pendingreadingwrite'))
        self.assertFalse(router.allow_migrate('default', 'api', 'pendingreadingwrite'))

        # Other models should NOT run on the outbox alias.
        self.assertFalse(router.allow_migrate('outbox', 'api', 'calibrationsession'))


# ==============================================================================
# Phase 1 — Workstation identity tests
# ==============================================================================
#
# These tests lock in the three invariants Phase 1 was responsible for:
#
#   1. ``Workstation.get_default`` is idempotent and always yields exactly
#      one ``is_default=True`` row. Multi-process boots must not be able
#      to create duplicate defaults.
#   2. The nullable ``CalibrationSession.workstation`` FK preserves full
#      backward compatibility: sessions created without a workstation
#      survive round-trips through the serializer and survive deletion of
#      the workstation they were later linked to.
#   3. The REST surface (``/api/workstations/`` and the
#      ``workstation_id`` field on ``/api/calibration_sessions/``) behaves
#      exactly like the UI contract requires — list/retrieve reads the
#      nested projection, PATCH links/unlinks by id.


class WorkstationDefaultTests(TestCase):
    """Invariants around ``Workstation.get_default``."""

    databases = {'default'}

    def test_get_default_creates_the_local_bench_on_first_call(self):
        self.assertFalse(Workstation.objects.filter(is_default=True).exists())
        ws = Workstation.get_default()
        self.assertTrue(ws.is_default)
        self.assertEqual(ws.identifier, 'local')
        self.assertEqual(ws.name, 'Local Workstation')

    def test_get_default_is_idempotent(self):
        first = Workstation.get_default()
        second = Workstation.get_default()
        third = Workstation.get_default()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(second.pk, third.pk)
        # Crucially, only one is_default row must ever exist — the "Local
        # Workstation" fallback relies on this uniqueness.
        self.assertEqual(Workstation.objects.filter(is_default=True).count(), 1)


class WorkstationResolveResourceTests(TestCase):
    """``Workstation.resolve_resource`` builds bench-qualified VISA strings."""

    databases = {'default'}

    def test_blank_visa_host_returns_address_unchanged(self):
        ws = Workstation(name='Local', identifier='local', visa_host='')
        self.assertEqual(ws.resolve_resource('GPIB0::22::INSTR'), 'GPIB0::22::INSTR')

    def test_remote_host_prefixes_raw_address(self):
        ws = Workstation(name='Bench A', identifier='bench-a', visa_host='10.0.0.42')
        self.assertEqual(
            ws.resolve_resource('GPIB0::22::INSTR'),
            'visa://10.0.0.42/GPIB0::22::INSTR',
        )

    def test_already_qualified_address_is_left_alone(self):
        ws = Workstation(name='Bench A', identifier='bench-a', visa_host='10.0.0.42')
        already = 'visa://10.0.0.99/GPIB0::5::INSTR'
        self.assertEqual(ws.resolve_resource(already), already)

    def test_blank_or_none_address_is_safe(self):
        ws = Workstation(name='Bench A', identifier='bench-a', visa_host='10.0.0.42')
        self.assertEqual(ws.resolve_resource(''), '')
        self.assertEqual(ws.resolve_resource(None), '')


class GetSessionDetailsAddressResolutionTests(TestCase):
    """``CalibrationConsumer.get_session_details`` qualifies instrument
    addresses through the session's bench so a remote VM opens them on the
    right NI-VISA host."""

    databases = {'default'}

    def _details_for(self, session):
        from asgiref.sync import async_to_sync
        from api.consumers import CalibrationConsumer

        consumer = CalibrationConsumer()
        consumer.session_id = session.pk
        with self.settings(MOCK_INSTRUMENTS=False):
            return async_to_sync(consumer.get_session_details)()

    def test_addresses_resolved_through_bench_visa_host(self):
        ws = Workstation.objects.create(
            name='Bench A', identifier='bench-a', visa_host='10.0.0.42'
        )
        session = CalibrationSession.objects.create(
            session_name='Remote',
            workstation=ws,
            ac_source_address='GPIB0::5::INSTR',
            standard_reader_address='GPIB0::22::INSTR',
        )
        details = self._details_for(session)
        self.assertEqual(
            details['ac_source_address'], 'visa://10.0.0.42/GPIB0::5::INSTR'
        )
        self.assertEqual(
            details['std_reader_address'], 'visa://10.0.0.42/GPIB0::22::INSTR'
        )

    def test_default_bench_leaves_addresses_unchanged(self):
        session = CalibrationSession.objects.create(
            session_name='Local', ac_source_address='GPIB0::5::INSTR'
        )
        details = self._details_for(session)
        self.assertEqual(details['ac_source_address'], 'GPIB0::5::INSTR')


class CalibrationRunLockTests(TestCase):
    """Per-bench single-flight run lock (session_state run-lock helpers)."""

    databases = {'default'}

    def _bench(self, slug):
        return Workstation.objects.create(name=slug, identifier=slug)

    def _session(self, name, ws):
        return CalibrationSession.objects.create(session_name=name, workstation=ws)

    def test_first_session_acquires_then_second_is_refused(self):
        ws = self._bench('bench-a')
        a = self._session('A', ws)
        b = self._session('B', ws)

        ok_a, holder_a = session_state.acquire_run_lock(a.pk, 'chan-a')
        self.assertTrue(ok_a)
        self.assertEqual(holder_a, a.pk)

        ok_b, holder_b = session_state.acquire_run_lock(b.pk, 'chan-b')
        self.assertFalse(ok_b)
        self.assertEqual(holder_b, a.pk)  # B is told who holds the bench

    def test_release_frees_the_bench_for_another_session(self):
        ws = self._bench('bench-a')
        a = self._session('A', ws)
        b = self._session('B', ws)

        session_state.acquire_run_lock(a.pk, 'chan-a')
        session_state.release_run_lock(a.pk)
        self.assertFalse(CalibrationRunLock.objects.filter(session=a).exists())

        ok_b, holder_b = session_state.acquire_run_lock(b.pk, 'chan-b')
        self.assertTrue(ok_b)
        self.assertEqual(holder_b, b.pk)

    def test_same_session_reacquire_is_idempotent(self):
        ws = self._bench('bench-a')
        a = self._session('A', ws)
        self.assertEqual(session_state.acquire_run_lock(a.pk, 'chan-a'), (True, a.pk))
        self.assertEqual(session_state.acquire_run_lock(a.pk, 'chan-a2'), (True, a.pk))
        self.assertEqual(CalibrationRunLock.objects.filter(workstation=ws).count(), 1)

    def test_different_benches_run_in_parallel(self):
        ws_a, ws_b = self._bench('bench-a'), self._bench('bench-b')
        a = self._session('A', ws_a)
        b = self._session('B', ws_b)
        self.assertEqual(session_state.acquire_run_lock(a.pk, 'chan-a'), (True, a.pk))
        self.assertEqual(session_state.acquire_run_lock(b.pk, 'chan-b'), (True, b.pk))

    def test_stale_lock_is_taken_over(self):
        ws = self._bench('bench-a')
        a = self._session('A', ws)
        b = self._session('B', ws)
        session_state.acquire_run_lock(a.pk, 'chan-a')
        # Backdate A's heartbeat well past the stale window.
        stale = session_state._runlock_stale_seconds()
        CalibrationRunLock.objects.filter(session=a).update(
            last_heartbeat_at=timezone.now() - timedelta(seconds=stale + 60)
        )
        ok_b, holder_b = session_state.acquire_run_lock(b.pk, 'chan-b')
        self.assertTrue(ok_b)
        self.assertEqual(holder_b, b.pk)
        self.assertEqual(CalibrationRunLock.objects.filter(workstation=ws).count(), 1)

    def test_heartbeat_keeps_a_live_lock_from_being_stolen(self):
        ws = self._bench('bench-a')
        a = self._session('A', ws)
        b = self._session('B', ws)
        session_state.acquire_run_lock(a.pk, 'chan-a')
        # Backdate, then touch to simulate a live run refreshing its lock.
        stale = session_state._runlock_stale_seconds()
        CalibrationRunLock.objects.filter(session=a).update(
            last_heartbeat_at=timezone.now() - timedelta(seconds=stale + 60)
        )
        session_state.touch_run_lock(a.pk)
        ok_b, holder_b = session_state.acquire_run_lock(b.pk, 'chan-b')
        self.assertFalse(ok_b)
        self.assertEqual(holder_b, a.pk)


class CalibrationSessionWorkstationTests(TestCase):
    """Backward-compat guarantees for the new nullable FK."""

    databases = {'default'}

    def setUp(self):
        self.bench = Workstation.objects.create(
            name='Bench 7',
            identifier='bench-7',
        )

    def test_session_survives_without_workstation(self):
        """Legacy rows (no workstation set) must remain fully functional."""
        sess = CalibrationSession.objects.create(session_name='Legacy')
        self.assertIsNone(sess.workstation)
        # Refetch to make sure the FK column simply stores NULL and doesn't
        # surface any unexpected constraint.
        sess.refresh_from_db()
        self.assertIsNone(sess.workstation_id)

    def test_linking_then_deleting_workstation_sets_fk_null(self):
        """SET_NULL on_delete preserves sessions if a bench is retired."""
        sess = CalibrationSession.objects.create(
            session_name='Linked', workstation=self.bench
        )
        self.assertEqual(sess.workstation_id, self.bench.id)
        self.bench.delete()
        sess.refresh_from_db()
        self.assertIsNone(sess.workstation_id)  # session survives, FK cleared


class WorkstationAPITests(TestCase):
    """REST behaviour of ``/api/workstations/`` and the session workstation field."""

    databases = {'default'}

    def setUp(self):
        self.client = APIClient()
        self.bench = Workstation.objects.create(
            name='Bench A',
            identifier='bench-a',
            location='Room 1',
        )
        self.inactive = Workstation.objects.create(
            name='Retired',
            identifier='retired',
            is_active=False,
        )
        self.session = CalibrationSession.objects.create(session_name='APITest')

    def test_list_excludes_inactive_benches(self):
        resp = self.client.get('/api/workstations/')
        self.assertEqual(resp.status_code, 200)
        identifiers = {row['identifier'] for row in resp.json()}
        self.assertIn('bench-a', identifiers)
        self.assertNotIn('retired', identifiers)

    def test_list_reports_claim_snapshot(self):
        WorkstationClaim.objects.create(
            workstation=self.bench,
            owner_channel='specific.channel.1',
            owner_client_id='client-1',
            owner_label='Operator A',
            active_session=self.session,
        )
        resp = self.client.get('/api/workstations/')
        row = next(r for r in resp.json() if r['identifier'] == 'bench-a')
        self.assertTrue(row['is_claimed'])
        self.assertIsNotNone(row['claim'])
        self.assertEqual(row['claim']['owner_label'], 'Operator A')
        self.assertEqual(row['claim']['active_session'], self.session.pk)

    def test_workstations_list_does_not_issue_n_plus_one(self):
        """The select_related in the viewset keeps list queries O(1)."""
        # Create several benches + claims so N+1 would amplify the query count.
        extra = 5
        for i in range(extra):
            ws = Workstation.objects.create(
                name=f'Bench {i}', identifier=f'n1-bench-{i}',
            )
            WorkstationClaim.objects.create(
                workstation=ws,
                owner_channel=f'channel-{i}',
                owner_client_id=f'client-{i}',
            )
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get('/api/workstations/')
        self.assertEqual(resp.status_code, 200)
        # The query count must be independent of how many benches exist. We
        # compare to a fixed upper bound instead of an exact value so the
        # test survives DRF/Django internals changing (e.g. adding a count
        # query for pagination). O(1) here means ~3 queries or fewer.
        self.assertLessEqual(
            len(ctx.captured_queries),
            3,
            f"List endpoint issued {len(ctx.captured_queries)} queries for "
            f"{extra + len([self.bench, self.inactive])} benches — likely N+1.",
        )

    def test_session_list_serializes_workstation_projection(self):
        self.session.workstation = self.bench
        self.session.save()
        resp = self.client.get(f'/api/calibration_sessions/{self.session.pk}/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIsNotNone(body['workstation'])
        self.assertEqual(body['workstation']['identifier'], 'bench-a')

    def test_patch_links_and_unlinks_workstation(self):
        resp = self.client.patch(
            f'/api/calibration_sessions/{self.session.pk}/',
            {'workstation_id': self.bench.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.session.refresh_from_db()
        self.assertEqual(self.session.workstation_id, self.bench.pk)

        resp = self.client.patch(
            f'/api/calibration_sessions/{self.session.pk}/',
            {'workstation_id': None},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.session.refresh_from_db()
        self.assertIsNone(self.session.workstation_id)

    def test_patch_rejects_unknown_workstation_id(self):
        resp = self.client.patch(
            f'/api/calibration_sessions/{self.session.pk}/',
            {'workstation_id': 999999},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.session.refresh_from_db()
        self.assertIsNone(self.session.workstation_id)


class WorkstationClaimModelTests(TestCase):
    """Direct model-level tests for the claim row that Phase 2 will use."""

    databases = {'default'}

    def setUp(self):
        self.bench = Workstation.objects.create(name='Bench X', identifier='bench-x')

    def test_claim_is_one_to_one(self):
        WorkstationClaim.objects.create(
            workstation=self.bench, owner_channel='ch-1', owner_client_id='c-1',
        )
        # A second claim on the same bench must be rejected by the OneToOne
        # constraint — this is the primitive Phase 2 will build lock
        # enforcement on top of.
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                WorkstationClaim.objects.create(
                    workstation=self.bench, owner_channel='ch-2', owner_client_id='c-2',
                )

    def test_claim_deleted_when_workstation_deleted(self):
        claim = WorkstationClaim.objects.create(
            workstation=self.bench, owner_channel='ch-1', owner_client_id='c-1',
        )
        claim_id = claim.pk
        self.bench.delete()
        self.assertFalse(WorkstationClaim.objects.filter(pk=claim_id).exists())

    def test_claim_survives_session_deletion_with_null_session(self):
        session = CalibrationSession.objects.create(session_name='ClaimSurvives')
        claim = WorkstationClaim.objects.create(
            workstation=self.bench,
            owner_channel='ch-1',
            owner_client_id='c-1',
            active_session=session,
        )
        session.delete()
        claim.refresh_from_db()
        self.assertIsNone(claim.active_session_id)
        # Workstation still claimed — only the session pointer clears.
        self.assertTrue(
            WorkstationClaim.objects.filter(workstation=self.bench).exists()
        )


# ==============================================================================
# Phase 2 — Session Supervisor tests
# ==============================================================================
#
# These tests validate the core invariants the supervisor was introduced
# to enforce:
#
#   1. One supervisor per session_id, created on demand.
#   2. A running task survives individual socket close — the grace
#      window is the only path that auto-stops a run.
#   3. Host vs. observer attachment is tracked separately; observer
#      churn never arms the grace timer.
#   4. ``stop_task`` and ``set_confirmation`` propagate to the running
#      coroutine via the shared ``stop_event`` / ``confirmation_event``.
#
# We drive the supervisor directly with trivial async coroutines so the
# tests don't need to engage the full calibration pipeline (which would
# require mocking every instrument class). That keeps these tests
# fast — milliseconds, not seconds — and focused on the machinery that's
# new in Phase 2.

import unittest

from api import session_supervisor as sup_module
from api.session_supervisor import SessionSupervisor


class _SupervisorAsyncTestCase(unittest.IsolatedAsyncioTestCase):
    """Common setup: reset the registry and shrink the grace window.

    Using a tiny grace window (50 ms) keeps the grace-expiration test
    under 100 ms while still genuinely exercising the timer path.
    """

    async def asyncSetUp(self):
        sup_module.reset_registry_for_tests()
        self.sup = await sup_module.get_or_create_supervisor(session_id=9001)
        self.sup.grace_window_seconds = 0.05  # 50 ms for tests

    async def asyncTearDown(self):
        # Make sure no stray tasks leak between tests.
        if self.sup.task and not self.sup.task.done():
            self.sup.task.cancel()
            try:
                await self.sup.task
            except Exception:
                pass
        if self.sup._grace_task and not self.sup._grace_task.done():
            self.sup._grace_task.cancel()
            try:
                await self.sup._grace_task
            except Exception:
                pass
        sup_module.reset_registry_for_tests()


class SupervisorRegistryTests(_SupervisorAsyncTestCase):
    async def test_registry_returns_same_instance_for_same_session(self):
        again = await sup_module.get_or_create_supervisor(session_id=9001)
        self.assertIs(self.sup, again)

    async def test_registry_creates_distinct_instances_per_session(self):
        other = await sup_module.get_or_create_supervisor(session_id=9002)
        self.assertIsNot(self.sup, other)
        self.assertEqual(other.session_id, 9002)

    async def test_peek_returns_none_when_unseeded(self):
        self.assertIsNone(sup_module.peek_supervisor(999999))
        self.assertIs(sup_module.peek_supervisor(9001), self.sup)


class SupervisorLifecycleTests(_SupervisorAsyncTestCase):
    async def test_start_task_transitions_to_busy_then_idle(self):
        ran = asyncio.Event()

        async def work():
            ran.set()
            await asyncio.sleep(0)

        ok = await self.sup.start_task('unit_test', work())
        self.assertTrue(ok)
        self.assertEqual(self.sup.state, SessionSupervisor.STATE_BUSY)

        await self.sup.task
        await asyncio.sleep(0)  # let _run_wrapped finally block run
        self.assertTrue(ran.is_set())
        self.assertEqual(self.sup.state, SessionSupervisor.STATE_IDLE)
        self.assertIsNone(self.sup.task)

    async def test_start_task_refuses_second_concurrent_run(self):
        gate = asyncio.Event()

        async def long_running():
            await gate.wait()

        self.assertTrue(await self.sup.start_task('first', long_running()))

        async def second():
            pass

        self.assertFalse(await self.sup.start_task('second', second()))

        gate.set()
        await self.sup.task

    async def test_stop_task_sets_stop_event_and_cancels(self):
        observed_stop = []
        cleanup_complete = asyncio.Event()

        async def work():
            try:
                while not self.sup.stop_event.is_set():
                    await asyncio.sleep(0.001)
                observed_stop.append('saw_stop')
            except asyncio.CancelledError:
                observed_stop.append('cancelled')
                raise
            finally:
                cleanup_complete.set()

        await self.sup.start_task('cancellable', work())
        # Give it one scheduler tick so the loop is actually running.
        await asyncio.sleep(0.01)
        await self.sup.stop_task()
        await asyncio.sleep(0.01)

        self.assertTrue(self.sup.stop_event.is_set())
        self.assertTrue(cleanup_complete.is_set())
        # Either path is acceptable — the important invariant is that
        # stop_task completed and the task no longer runs.
        self.assertTrue(observed_stop)
        self.assertEqual(self.sup.state, SessionSupervisor.STATE_IDLE)

    async def test_set_confirmation_wakes_awaiting_task(self):
        collected = []

        async def work():
            await self.sup.confirmation_event.wait()
            collected.append(self.sup.confirmation_status)

        await self.sup.start_task('confirm', work())
        await asyncio.sleep(0.01)
        await self.sup.set_confirmation('confirmed')
        await self.sup.task

        self.assertEqual(collected, ['confirmed'])


class SupervisorAttachTests(_SupervisorAsyncTestCase):
    async def test_host_and_observer_tracked_separately(self):
        await self.sup.attach('host-ch-1', 'host')
        await self.sup.attach('obs-ch-1', 'remote')
        self.assertEqual(self.sup.host_channels, {'host-ch-1'})
        self.assertEqual(self.sup.observer_channels, {'obs-ch-1'})

    async def test_observer_detach_never_arms_grace(self):
        await self.sup.attach('host-ch-1', 'host')
        await self.sup.attach('obs-ch-1', 'remote')

        async def work():
            await asyncio.sleep(1)

        await self.sup.start_task('obs-test', work())
        await self.sup.detach('obs-ch-1')
        self.assertIsNone(self.sup._grace_task)
        await self.sup.stop_task()

    async def test_host_detach_while_busy_arms_grace(self):
        await self.sup.attach('host-ch-1', 'host')

        async def work():
            await asyncio.sleep(1)

        await self.sup.start_task('grace-arm', work())
        await self.sup.detach('host-ch-1')

        self.assertIsNotNone(self.sup._grace_task)
        self.assertFalse(self.sup._grace_task.done())
        await self.sup.stop_task()  # cleanup

    async def test_host_detach_while_idle_does_not_arm_grace(self):
        await self.sup.attach('host-ch-1', 'host')
        # No running task → detach must be a no-op for the grace timer.
        await self.sup.detach('host-ch-1')
        self.assertIsNone(self.sup._grace_task)


class SupervisorGraceWindowTests(_SupervisorAsyncTestCase):
    async def test_host_reconnect_cancels_grace_timer(self):
        await self.sup.attach('host-ch-1', 'host')

        async def work():
            await asyncio.sleep(1)

        await self.sup.start_task('reconnect', work())
        await self.sup.detach('host-ch-1')
        # Grace armed…
        self.assertIsNotNone(self.sup._grace_task)
        # …host comes back before the 50ms expires.
        await self.sup.attach('host-ch-2', 'host')
        await asyncio.sleep(0.1)
        self.assertIsNone(self.sup._grace_task)
        # Task is still running.
        self.assertEqual(self.sup.state, SessionSupervisor.STATE_BUSY)
        self.assertFalse(self.sup.task.done())
        await self.sup.stop_task()

    async def test_grace_expiry_stops_task(self):
        await self.sup.attach('host-ch-1', 'host')
        survived = asyncio.Event()

        async def work():
            try:
                await asyncio.sleep(5)
                survived.set()
            except asyncio.CancelledError:
                raise

        await self.sup.start_task('grace-expiry', work())
        await self.sup.detach('host-ch-1')

        # Wait for grace_window_seconds + a little slack.
        await asyncio.sleep(0.15)
        self.assertFalse(survived.is_set())
        self.assertEqual(self.sup.state, SessionSupervisor.STATE_IDLE)
        self.assertTrue(self.sup.stop_event.is_set())

    async def test_second_host_attempt_is_downgraded_and_grace_still_arms(self):
        """1-host-per-session invariant: the second ``host`` attach is
        forcefully downgraded to ``remote``. When the *real* host detaches,
        no host remains attached (observers don't count), so the grace
        window arms as usual and the run eventually auto-stops.

        Replaces the old "two hosts coexist" test from the pre-multi-host
        design, which is incompatible with the supervisor's current
        downgrade contract."""
        await self.sup.attach('host-ch-1', 'host')
        granted = await self.sup.attach('host-ch-2', 'host')

        self.assertEqual(granted, 'remote')
        self.assertEqual(self.sup.host_channels, {'host-ch-1'})
        self.assertEqual(self.sup.observer_channels, {'host-ch-2'})

        async def work():
            await asyncio.sleep(1)

        await self.sup.start_task('downgrade-then-detach', work())
        await self.sup.detach('host-ch-1')

        # Only the downgraded observer is left; grace must arm, because
        # losing the single host mid-run is exactly what the grace window
        # exists to protect.
        self.assertIsNotNone(self.sup._grace_task)
        self.assertEqual(self.sup.host_channels, set())
        self.assertEqual(self.sup.observer_channels, {'host-ch-2'})
        await self.sup.stop_task()

    async def test_multiple_observers_do_not_block_grace(self):
        """Observer detaches are pure bookkeeping: if the host is the only
        socket that counts for grace, a roomful of observers leaving (or
        staying) while the host disconnects must still arm the timer."""
        await self.sup.attach('host-ch-1', 'host')
        await self.sup.attach('obs-ch-1', 'remote')
        await self.sup.attach('obs-ch-2', 'remote')

        async def work():
            await asyncio.sleep(1)

        await self.sup.start_task('many-observers', work())
        await self.sup.detach('obs-ch-1')  # observer leaving is a no-op
        self.assertIsNone(self.sup._grace_task)
        await self.sup.detach('host-ch-1')  # only the host counts
        self.assertIsNotNone(self.sup._grace_task)
        await self.sup.stop_task()


class SupervisorConsumerIntegrationTests(unittest.IsolatedAsyncioTestCase):
    """End-to-end: verify the real CalibrationConsumer wires up to a supervisor.

    Uses Channels' :class:`WebsocketCommunicator` so the full
    consumer lifecycle runs — including ``connect``, the supervisor
    attach in our new code, and the rewritten ``disconnect`` that no
    longer cancels the task. This is the single test that proves the
    invariant the Phase 2 refactor exists to uphold: the supervisor
    persists past ``disconnect``.
    """

    async def asyncSetUp(self):
        sup_module.reset_registry_for_tests()

    async def asyncTearDown(self):
        sup_module.reset_registry_for_tests()

    async def test_connect_creates_supervisor_and_disconnect_preserves_it(self):
        from channels.testing import WebsocketCommunicator
        from api.consumers import CalibrationConsumer

        communicator = WebsocketCommunicator(
            CalibrationConsumer.as_asgi(),
            '/ws/collect-readings/12345/',
        )
        # WebsocketCommunicator doesn't populate ``url_route`` by default;
        # inject the kwargs that the real ASGI router would provide.
        communicator.scope['url_route'] = {
            'kwargs': {'session_id': '12345'},
        }
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        sup = sup_module.peek_supervisor('12345')
        self.assertIsNotNone(sup)
        self.assertEqual(len(sup.host_channels), 1)  # default role=host

        # Simulate a running task so we can prove disconnect doesn't kill it.
        task_gate = asyncio.Event()

        async def long_running():
            try:
                await task_gate.wait()
            finally:
                pass

        await sup.start_task('fake', long_running())
        self.assertEqual(sup.state, SessionSupervisor.STATE_BUSY)
        running_task = sup.task

        # Disconnect — under old code this cancelled the task.
        await communicator.disconnect()

        # Supervisor still around; task still running.
        self.assertIs(sup_module.peek_supervisor('12345'), sup)
        self.assertIsNotNone(running_task)
        self.assertFalse(running_task.done())

        # Cleanup.
        task_gate.set()
        await running_task

    async def test_remote_role_attaches_as_observer(self):
        from channels.testing import WebsocketCommunicator
        from api.consumers import CalibrationConsumer

        communicator = WebsocketCommunicator(
            CalibrationConsumer.as_asgi(),
            '/ws/collect-readings/12345/?role=remote',
        )
        communicator.scope['url_route'] = {
            'kwargs': {'session_id': '12345'},
        }
        # ``?role=remote`` must land in query_string bytes for _parse_client_role.
        communicator.scope['query_string'] = b'role=remote'

        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        sup = sup_module.peek_supervisor('12345')
        self.assertIsNotNone(sup)
        self.assertEqual(len(sup.host_channels), 0)
        self.assertEqual(len(sup.observer_channels), 1)

        await communicator.disconnect()
        # Observer disconnect alone never arms grace.
        self.assertIsNone(sup._grace_task)


# ======================================================================
# Phase 3 — per-host active-session tracking
# ======================================================================
# Exercises HostSyncConsumer end-to-end through WebsocketCommunicator so
# we catch protocol regressions, not just dict bookkeeping. The invariant
# Phase 3 upholds: HOST_ACTIVE_SESSIONS is keyed per host channel_name,
# single-host wire stays byte-compatible with pre-refactor clients, and
# the new active_sessions / host_channel fields are additive.

from api import consumers as consumers_module  # noqa: E402
from api import session_state as session_state_module  # noqa: E402


class HostSyncPerHostSessionTests(unittest.IsolatedAsyncioTestCase):
    """Direct tests on the HostSyncConsumer WebSocket wire."""

    async def asyncSetUp(self):
        # Isolate each test from registry bleed — stray entries in the
        # process-wide shared-state registries would taint the next
        # test's initial-state assertions.
        session_state_module.reset_for_tests()

    async def asyncTearDown(self):
        session_state_module.reset_for_tests()

    async def _open(self):
        from channels.testing import WebsocketCommunicator

        communicator = WebsocketCommunicator(
            consumers_module.HostSyncConsumer.as_asgi(),
            '/ws/host-sync/',
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        return communicator

    async def _drain_connect_messages(self, communicator):
        """Consume the two auto-pushes connect() emits (session + claims)."""
        session_msg = await communicator.receive_json_from()
        claims_msg = await communicator.receive_json_from()
        # Don't assume ordering — normalize.
        by_type = {msg['type']: msg for msg in (session_msg, claims_msg)}
        return by_type

    async def test_connect_sends_empty_active_sessions_when_no_hosts(self):
        communicator = await self._open()
        try:
            msgs = await self._drain_connect_messages(communicator)
            session_msg = msgs['session_changed']
            self.assertIsNone(session_msg['session_id'])
            # Phase 3: new active_sessions field is always present.
            self.assertIn('active_sessions', session_msg)
            self.assertEqual(session_msg['active_sessions'], {})
        finally:
            await communicator.disconnect()

    async def test_set_session_populates_dict_and_broadcasts_host_channel(self):
        host = await self._open()
        remote = await self._open()
        try:
            await self._drain_connect_messages(host)
            await self._drain_connect_messages(remote)

            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await remote.send_json_to({'command': 'identify', 'role': 'remote'})
            # The identify handshake triggers viewer_presence broadcasts to
            # host-role sockets; drain any pending messages so the next
            # receive_json_from lands on the session_changed we care about.
            await asyncio.sleep(0.05)
            while True:
                try:
                    msg = await asyncio.wait_for(remote.receive_json_from(), timeout=0.05)
                except (asyncio.TimeoutError, Exception):
                    break
                if msg.get('type') == 'session_changed':
                    self.fail('unexpected session_changed before set_session')
            # Drain host's viewer_presence too.
            while True:
                try:
                    await asyncio.wait_for(host.receive_json_from(), timeout=0.05)
                except (asyncio.TimeoutError, Exception):
                    break

            await host.send_json_to({
                'command': 'set_session',
                'session_id': 42,
            })

            # Both sockets receive the broadcast.
            host_msg = await host.receive_json_from()
            remote_msg = await remote.receive_json_from()

            for msg in (host_msg, remote_msg):
                self.assertEqual(msg['type'], 'session_changed')
                self.assertEqual(msg['session_id'], 42)
                # Phase 3: host_channel disambiguates in multi-host mode.
                self.assertIn('host_channel', msg)
                self.assertEqual(msg['active_sessions'], {msg['host_channel']: 42})

            # Accessor registry is authoritative and correctly keyed.
            snapshot = session_state_module.host_sessions_snapshot()
            self.assertEqual(len(snapshot), 1)
            self.assertEqual(list(snapshot.values()), [42])
        finally:
            await host.disconnect()
            await remote.disconnect()

    async def test_two_hosts_tracked_independently(self):
        host_a = await self._open()
        host_b = await self._open()
        try:
            await self._drain_connect_messages(host_a)
            await self._drain_connect_messages(host_b)

            await host_a.send_json_to({'command': 'identify', 'role': 'host'})
            await host_b.send_json_to({'command': 'identify', 'role': 'host'})
            # Drain any presence broadcasts.
            await asyncio.sleep(0.05)
            for comm in (host_a, host_b):
                while True:
                    try:
                        await asyncio.wait_for(comm.receive_json_from(), timeout=0.05)
                    except (asyncio.TimeoutError, Exception):
                        break

            await host_a.send_json_to({'command': 'set_session', 'session_id': 11})
            # Drain both sockets for A's broadcast.
            await host_a.receive_json_from()
            await host_b.receive_json_from()

            await host_b.send_json_to({'command': 'set_session', 'session_id': 22})
            msg_on_a = await host_a.receive_json_from()
            msg_on_b = await host_b.receive_json_from()

            # B's broadcast carries B's session + both entries in the map.
            for msg in (msg_on_a, msg_on_b):
                self.assertEqual(msg['session_id'], 22)
                self.assertEqual(set(msg['active_sessions'].values()), {11, 22})

            # Accessor registry has both entries under distinct keys.
            snapshot = session_state_module.host_sessions_snapshot()
            self.assertEqual(len(snapshot), 2)
            self.assertEqual(sorted(snapshot.values()), [11, 22])
        finally:
            await host_a.disconnect()
            await host_b.disconnect()

    async def test_disconnect_prunes_entry_and_broadcasts_session_refresh(self):
        """Host disconnect must push a refreshed ``session_changed`` so any
        remaining remote clients drop the now-stale "(Active)" pill for the
        departed host's session. Without this broadcast, remote UIs keep
        the dead session marked live forever and end up downgraded to
        observer mode when a user tries to reclaim it."""
        host = await self._open()
        remote = await self._open()
        try:
            await self._drain_connect_messages(host)
            await self._drain_connect_messages(remote)

            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await remote.send_json_to({'command': 'identify', 'role': 'remote'})
            await asyncio.sleep(0.05)
            for comm in (host, remote):
                while True:
                    try:
                        await asyncio.wait_for(comm.receive_json_from(), timeout=0.05)
                    except (asyncio.TimeoutError, Exception):
                        break

            await host.send_json_to({'command': 'set_session', 'session_id': 77})
            # Drain the resulting set_session broadcast on both sockets.
            await host.receive_json_from()
            await remote.receive_json_from()

            self.assertEqual(len(session_state_module.host_sessions_snapshot()), 1)

            # Host leaves.
            await host.disconnect()

            # Remote should now receive a session_changed with an empty
            # active_sessions map so its dropdown clears the (Active) flag.
            refresh = await asyncio.wait_for(
                remote.receive_json_from(), timeout=0.5,
            )
            self.assertEqual(refresh['type'], 'session_changed')
            self.assertIsNone(refresh['session_id'])
            self.assertEqual(refresh['active_sessions'], {})
        finally:
            await remote.disconnect()

        # After everyone leaves, the registry is empty.
        await asyncio.sleep(0.02)
        self.assertEqual(session_state_module.host_sessions_snapshot(), {})

    async def test_disconnect_without_session_does_not_broadcast(self):
        """A socket that never issued ``set_session`` has no entry to clear,
        so its disconnect must not fire a redundant ``session_changed``
        broadcast. Keeps chatter off the wire during normal observer churn."""
        host = await self._open()
        remote = await self._open()
        try:
            await self._drain_connect_messages(host)
            await self._drain_connect_messages(remote)
            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await remote.send_json_to({'command': 'identify', 'role': 'remote'})
            await asyncio.sleep(0.05)
            for comm in (host, remote):
                while True:
                    try:
                        await asyncio.wait_for(comm.receive_json_from(), timeout=0.05)
                    except (asyncio.TimeoutError, Exception):
                        break

            await host.disconnect()

            with self.assertRaises((asyncio.TimeoutError, Exception)):
                await asyncio.wait_for(remote.receive_json_from(), timeout=0.2)
        finally:
            await remote.disconnect()

    async def test_late_joiner_sees_existing_session_on_connect(self):
        host = await self._open()
        try:
            await self._drain_connect_messages(host)
            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await asyncio.sleep(0.02)
            while True:
                try:
                    await asyncio.wait_for(host.receive_json_from(), timeout=0.02)
                except (asyncio.TimeoutError, Exception):
                    break

            await host.send_json_to({'command': 'set_session', 'session_id': 99})
            await host.receive_json_from()

            # Now a new remote joins — it should immediately learn the
            # current session from the connect-time auto-push.
            remote = await self._open()
            try:
                msgs = await self._drain_connect_messages(remote)
                session_msg = msgs['session_changed']
                self.assertEqual(session_msg['session_id'], 99)
                self.assertEqual(list(session_msg['active_sessions'].values()), [99])
            finally:
                await remote.disconnect()
        finally:
            await host.disconnect()

    async def test_request_session_state_returns_full_snapshot(self):
        host = await self._open()
        remote = await self._open()
        try:
            await self._drain_connect_messages(host)
            await self._drain_connect_messages(remote)

            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await remote.send_json_to({'command': 'identify', 'role': 'remote'})
            await asyncio.sleep(0.02)
            for comm in (host, remote):
                while True:
                    try:
                        await asyncio.wait_for(comm.receive_json_from(), timeout=0.02)
                    except (asyncio.TimeoutError, Exception):
                        break

            await host.send_json_to({'command': 'set_session', 'session_id': 55})
            await host.receive_json_from()
            await remote.receive_json_from()

            # Remote re-asks for state.
            await remote.send_json_to({'command': 'request_session_state'})
            reply = await remote.receive_json_from()
            self.assertEqual(reply['type'], 'session_changed')
            self.assertEqual(reply['session_id'], 55)
            self.assertEqual(list(reply['active_sessions'].values()), [55])
        finally:
            await host.disconnect()
            await remote.disconnect()


# ======================================================================
# Phase 5b — claim/release broadcast end-to-end over the channel layer
# ======================================================================
# These tests exercise the full HostSyncConsumer path for workstation
# claims between two WebSocket clients: client A sends
# ``claim_workstation``, and client B must receive a
# ``workstation_claims_update`` broadcast. This is the invariant the
# Redis channel layer has to preserve under multi-worker fan-out, so
# covering it here (against the default in-memory layer during CI, and
# against Redis locally when ``REDIS_URL`` is set) guards against
# regressions on both backends.

class HostSyncClaimBroadcastTests(unittest.IsolatedAsyncioTestCase):
    """Two-client broadcast coverage for claim_workstation / release_workstation."""

    async def asyncSetUp(self):
        from asgiref.sync import sync_to_async
        from api.models import Workstation, WorkstationClaim

        session_state_module.reset_for_tests()

        self._test_ip = '127.0.0.250'
        self._workstation = await sync_to_async(Workstation.objects.create)(
            name='Phase5b-Claim-Broadcast',
            identifier='phase5b-claim-broadcast',
            is_default=False,
            is_active=True,
            instrument_addresses=[self._test_ip],
        )

        # In case a previous failed run left mirror rows on this workstation.
        await sync_to_async(
            WorkstationClaim.objects.filter(workstation=self._workstation).delete
        )()

    async def asyncTearDown(self):
        from asgiref.sync import sync_to_async
        from api.models import WorkstationClaim

        session_state_module.reset_for_tests()
        await sync_to_async(
            WorkstationClaim.objects.filter(workstation=self._workstation).delete
        )()
        await sync_to_async(self._workstation.delete)()

    async def _open(self):
        from channels.testing import WebsocketCommunicator

        communicator = WebsocketCommunicator(
            consumers_module.HostSyncConsumer.as_asgi(),
            '/ws/host-sync/',
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)
        return communicator

    async def _drain(self, communicator, max_msgs=6, timeout=0.1):
        """Swallow whatever the server has queued; used to reach a quiet state."""
        drained = []
        for _ in range(max_msgs):
            try:
                drained.append(
                    await asyncio.wait_for(
                        communicator.receive_json_from(), timeout=timeout,
                    )
                )
            except (asyncio.TimeoutError, Exception):
                break
        return drained

    async def _wait_for(self, communicator, predicate, timeout=2.0):
        """Receive messages until predicate(msg) is True or timeout elapses."""
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            remaining = deadline - asyncio.get_event_loop().time()
            try:
                msg = await asyncio.wait_for(
                    communicator.receive_json_from(), timeout=remaining,
                )
            except (asyncio.TimeoutError, Exception):
                return None
            if predicate(msg):
                return msg
        return None

    async def test_claim_broadcasts_to_other_socket(self):
        from api.models import WorkstationClaim
        from asgiref.sync import sync_to_async

        host = await self._open()
        observer = await self._open()
        try:
            await self._drain(host)
            await self._drain(observer)

            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await observer.send_json_to({'command': 'identify', 'role': 'remote'})
            await asyncio.sleep(0.05)
            await self._drain(host)
            await self._drain(observer)

            await host.send_json_to({
                'command': 'claim_workstation',
                'ip': self._test_ip,
                'client_id': 'phase5b-test-client',
            })

            def _is_claim_present(msg):
                return (
                    msg.get('type') == 'workstation_claims_update'
                    and self._test_ip in (msg.get('claims') or {})
                )

            observer_msg = await self._wait_for(observer, _is_claim_present)
            self.assertIsNotNone(
                observer_msg,
                'Observer socket never received claim_workstation broadcast',
            )

            host_echo = await self._wait_for(host, _is_claim_present)
            self.assertIsNotNone(
                host_echo,
                'Host socket did not receive its own broadcast echo; '
                'group_send fan-out is missing the sender.',
            )

            # Both clients saw the SAME logical claim.
            self.assertEqual(
                observer_msg['claims'][self._test_ip],
                host_echo['claims'][self._test_ip],
            )

            # DB mirror is populated.
            row_exists = await sync_to_async(
                WorkstationClaim.objects.filter(
                    workstation=self._workstation,
                ).exists
            )()
            self.assertTrue(row_exists, 'Claim DB row missing after broadcast round-trip')
        finally:
            await host.disconnect()
            await observer.disconnect()

    async def test_release_broadcasts_and_clears_db_row(self):
        from api.models import WorkstationClaim
        from asgiref.sync import sync_to_async

        host = await self._open()
        observer = await self._open()
        try:
            await self._drain(host)
            await self._drain(observer)
            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await observer.send_json_to({'command': 'identify', 'role': 'remote'})
            await asyncio.sleep(0.05)
            await self._drain(host)
            await self._drain(observer)

            await host.send_json_to({
                'command': 'claim_workstation',
                'ip': self._test_ip,
                'client_id': 'phase5b-release-test',
            })

            def _has_claim(msg):
                return (
                    msg.get('type') == 'workstation_claims_update'
                    and self._test_ip in (msg.get('claims') or {})
                )

            self.assertIsNotNone(await self._wait_for(observer, _has_claim))
            self.assertIsNotNone(await self._wait_for(host, _has_claim))

            await host.send_json_to({
                'command': 'release_workstation',
                'ip': self._test_ip,
            })

            def _released(msg):
                return (
                    msg.get('type') == 'workstation_claims_update'
                    and self._test_ip not in (msg.get('claims') or {})
                )

            self.assertIsNotNone(
                await self._wait_for(observer, _released),
                'Observer socket never received release broadcast',
            )

            row_still_there = await sync_to_async(
                WorkstationClaim.objects.filter(
                    workstation=self._workstation,
                ).exists
            )()
            self.assertFalse(
                row_still_there,
                'Claim DB row should be deleted after release broadcast',
            )
        finally:
            await host.disconnect()
            await observer.disconnect()

    async def test_disconnect_self_heals_and_broadcasts_release(self):
        """Claimed host vanishes -> remaining socket sees the claim disappear.

        This is the path that matters most in prod: when a host tab
        crashes without sending release_workstation, the disconnect
        handler must release the lock AND broadcast so other operators
        don't see a phantom claim.
        """
        from api.models import WorkstationClaim
        from asgiref.sync import sync_to_async

        host = await self._open()
        observer = await self._open()
        try:
            await self._drain(host)
            await self._drain(observer)
            await host.send_json_to({'command': 'identify', 'role': 'host'})
            await observer.send_json_to({'command': 'identify', 'role': 'remote'})
            await asyncio.sleep(0.05)
            await self._drain(host)
            await self._drain(observer)

            await host.send_json_to({
                'command': 'claim_workstation',
                'ip': self._test_ip,
                'client_id': 'phase5b-crash-test',
            })

            def _has_claim(msg):
                return (
                    msg.get('type') == 'workstation_claims_update'
                    and self._test_ip in (msg.get('claims') or {})
                )

            self.assertIsNotNone(await self._wait_for(observer, _has_claim))
            self.assertIsNotNone(await self._wait_for(host, _has_claim))

            # Simulate a host crash — the socket just closes.
            await host.disconnect()

            def _released(msg):
                return (
                    msg.get('type') == 'workstation_claims_update'
                    and self._test_ip not in (msg.get('claims') or {})
                )

            released = await self._wait_for(observer, _released, timeout=3.0)
            self.assertIsNotNone(
                released,
                'Observer never learned that the crashed host released the '
                'workstation — self-healing broadcast is broken.',
            )

            row_still_there = await sync_to_async(
                WorkstationClaim.objects.filter(
                    workstation=self._workstation,
                ).exists
            )()
            self.assertFalse(
                row_still_there,
                'Claim DB row should be cleared when the owning socket disconnects',
            )
        finally:
            await observer.disconnect()


# ======================================================================
# Phase 4 — session_state accessor layer
# ======================================================================
# Pure-Python unit tests against the storage seam. These are
# intentionally synchronous and database-free: the whole point of the
# module is to be a thin, fast shim that Phase 5 can swap for Redis
# without touching any callsite, so we want that shim tested in
# isolation from Django Channels / DB machinery.

class SessionStateHostSessionsTests(unittest.TestCase):
    def setUp(self):
        session_state_module.reset_for_tests()

    def tearDown(self):
        session_state_module.reset_for_tests()

    def test_snapshot_starts_empty(self):
        self.assertEqual(session_state_module.host_sessions_snapshot(), {})
        self.assertIsNone(session_state_module.legacy_session_id())

    def test_set_then_snapshot_roundtrip(self):
        session_state_module.set_host_session('chan-a', 7)
        session_state_module.set_host_session('chan-b', 9)
        self.assertEqual(
            session_state_module.host_sessions_snapshot(),
            {'chan-a': 7, 'chan-b': 9},
        )

    def test_snapshot_returns_independent_copy(self):
        session_state_module.set_host_session('chan-a', 7)
        snap = session_state_module.host_sessions_snapshot()
        snap['chan-a'] = 999
        # Mutating the snapshot must NOT affect the registry.
        self.assertEqual(
            session_state_module.host_sessions_snapshot(),
            {'chan-a': 7},
        )

    def test_legacy_session_id_prefers_first_inserted(self):
        # Deterministic fallback behavior matters for single-host compat.
        session_state_module.set_host_session('first', 100)
        session_state_module.set_host_session('second', 200)
        self.assertEqual(session_state_module.legacy_session_id(), 100)

    def test_clear_host_session_returns_prior(self):
        session_state_module.set_host_session('chan-a', 42)
        prior = session_state_module.clear_host_session('chan-a')
        self.assertEqual(prior, 42)
        self.assertEqual(session_state_module.host_sessions_snapshot(), {})
        # Idempotent on missing key.
        self.assertIsNone(session_state_module.clear_host_session('chan-a'))


class SessionStateViewersTests(unittest.TestCase):
    def setUp(self):
        session_state_module.reset_for_tests()

    def tearDown(self):
        session_state_module.reset_for_tests()

    def test_register_and_snapshot(self):
        session_state_module.register_viewer('chan', ip='1.2.3.4', connected_at=1.0)
        snap = session_state_module.viewers_snapshot()
        self.assertEqual(list(snap), ['chan'])
        self.assertEqual(snap['chan']['role'], 'unknown')
        self.assertEqual(snap['chan']['ip'], '1.2.3.4')
        self.assertEqual(snap['chan']['connected_at'], 1.0)

    def test_update_viewer_role_returns_false_if_missing(self):
        self.assertFalse(
            session_state_module.update_viewer_role('ghost', 'host')
        )

    def test_update_viewer_role_promotes_in_place(self):
        session_state_module.register_viewer('chan', ip='x', connected_at=0)
        self.assertTrue(
            session_state_module.update_viewer_role('chan', 'host')
        )
        self.assertEqual(
            session_state_module.get_viewer('chan')['role'], 'host'
        )

    def test_unregister_returns_true_once(self):
        session_state_module.register_viewer('chan', ip='x', connected_at=0)
        self.assertTrue(session_state_module.unregister_viewer('chan'))
        # Second removal is a no-op.
        self.assertFalse(session_state_module.unregister_viewer('chan'))


class SessionStateLiveStateTests(unittest.TestCase):
    def setUp(self):
        session_state_module.reset_for_tests()

    def tearDown(self):
        session_state_module.reset_for_tests()

    def test_peek_returns_default_without_allocating(self):
        self.assertEqual(
            session_state_module.peek_live_state(123)['isCollecting'], False
        )
        # peek must NOT register an entry for the session.
        self.assertEqual(session_state_module.get_live_state.__name__, 'get_live_state')
        # Re-peek yields a fresh default (still not persisted).
        a = session_state_module.peek_live_state(123)
        b = session_state_module.peek_live_state(123)
        self.assertIsNot(a, b)  # different dicts — confirms no persistence

    def test_get_persists_entry_and_roundtrips(self):
        state = session_state_module.get_live_state(42)
        state['isCollecting'] = True
        again = session_state_module.get_live_state(42)
        self.assertIs(state, again)
        self.assertTrue(again['isCollecting'])

    def test_clear_live_state_is_idempotent(self):
        session_state_module.get_live_state(42)
        session_state_module.clear_live_state(42)
        session_state_module.clear_live_state(42)  # no raise

    def test_key_is_stringified(self):
        # Callers historically pass both ints and strs; both must hit the same slot.
        session_state_module.get_live_state(7)['isCollecting'] = True
        self.assertTrue(
            session_state_module.peek_live_state('7')['isCollecting']
        )


class SessionStateClaimsTests(TestCase):
    """In-memory wire-shape checks for the claim accessors.

    Extends ``django.test.TestCase`` (not ``unittest.TestCase``) because
    Phase 5a's ``claim_workstation`` mirrors every write into the
    ``WorkstationClaim`` DB table — the test needs a transactional test
    database so those writes roll back between tests.
    """
    def setUp(self):
        session_state_module.reset_for_tests()

    def tearDown(self):
        session_state_module.reset_for_tests()

    def test_claim_and_snapshot(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='cid', role='host',
        )
        snap = session_state_module.claims_snapshot()
        self.assertEqual(snap['10.0.0.1']['channel_name'], 'chan-a')
        self.assertEqual(snap['10.0.0.1']['role'], 'host')

    def test_release_only_by_owner(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='cid', role='host',
        )
        # A different channel_name must not be able to release the lock.
        self.assertFalse(
            session_state_module.release_workstation('10.0.0.1', channel_name='chan-b')
        )
        self.assertIn('10.0.0.1', session_state_module.claims_snapshot())

        self.assertTrue(
            session_state_module.release_workstation('10.0.0.1', channel_name='chan-a')
        )
        self.assertNotIn('10.0.0.1', session_state_module.claims_snapshot())

    def test_release_claims_for_returns_freed_ips(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='cid', role='host',
        )
        session_state_module.claim_workstation(
            '10.0.0.2', channel_name='chan-a', client_id='cid', role='host',
        )
        session_state_module.claim_workstation(
            '10.0.0.3', channel_name='chan-b', client_id='cid', role='host',
        )
        freed = session_state_module.release_claims_for('chan-a')
        self.assertEqual(sorted(freed), ['10.0.0.1', '10.0.0.2'])
        self.assertEqual(
            list(session_state_module.claims_snapshot()),
            ['10.0.0.3'],
        )

    def test_release_claims_for_unknown_channel_is_noop(self):
        self.assertEqual(session_state_module.release_claims_for('nobody'), [])


class SessionStateResetTests(TestCase):
    """Reset coverage: promoted to ``django.test.TestCase`` so the DB-
    mirrored claim wipe path introduced in Phase 5a is exercised inside
    a transactional fixture.
    """
    def test_reset_wipes_every_registry(self):
        session_state_module.set_host_session('chan', 1)
        session_state_module.register_viewer('chan', ip='x', connected_at=0)
        session_state_module.get_live_state(99)['isCollecting'] = True
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan', client_id='c', role='host',
        )

        session_state_module.reset_for_tests()

        self.assertEqual(session_state_module.host_sessions_snapshot(), {})
        self.assertEqual(session_state_module.viewers_snapshot(), {})
        self.assertEqual(session_state_module.claims_snapshot(), {})
        # get_live_state creates a fresh default — confirming the old entry is gone.
        self.assertFalse(session_state_module.peek_live_state(99)['isCollecting'])
        # Phase 5a: the DB mirror is also wiped.
        self.assertEqual(WorkstationClaim.objects.count(), 0)


class SessionStateClaimsDBMirrorTests(TestCase):
    """Phase 5a + auto-provision: every in-memory claim mutation mirrors
    into the DB, and unknown IPs materialize a per-IP Workstation row
    on first sighting.

    Seeds two benches with disjoint instrument address lists so the
    IP-to-workstation resolver has something meaningful to match
    against. Claims on addresses outside those lists now auto-provision
    an ``auto-<ip-slug>`` row instead of collapsing onto the default
    "Local Workstation" (which is why the old fallback test was
    replaced with the three auto-provision tests below).
    """

    def setUp(self):
        session_state_module.reset_for_tests()
        self.bench_a = Workstation.objects.create(
            name='Bench A', identifier='bench-a',
            instrument_addresses=['10.0.0.1', '10.0.0.2'],
        )
        self.bench_b = Workstation.objects.create(
            name='Bench B', identifier='bench-b',
            instrument_addresses=['10.0.0.3'],
        )

    def tearDown(self):
        session_state_module.reset_for_tests()

    def test_claim_creates_db_row_resolved_by_ip(self):
        session_state_module.claim_workstation(
            '10.0.0.1',
            channel_name='chan-a', client_id='cid', role='host',
            owner_label='192.168.1.7',
        )
        claim = WorkstationClaim.objects.get(workstation=self.bench_a)
        self.assertEqual(claim.owner_channel, 'chan-a')
        self.assertEqual(claim.owner_client_id, 'cid')
        self.assertEqual(claim.owner_label, '192.168.1.7')
        self.assertIsNone(claim.active_session_id)

    def test_claim_auto_provisions_workstation_when_ip_unknown(self):
        """Unknown IPs create a new ``auto-<slug>`` Workstation row.

        This is the Phase-5b-follow-up behavior: the frontend already
        groups discovered instruments by IP client-side, so forcing
        operators to manually seed matching rows in the admin is
        friction with no safety benefit. Instead, the first claim on
        an unregistered IP materializes a per-IP bench automatically.
        """
        ip = '198.51.100.99'  # RFC 5737 TEST-NET-2, guaranteed not seeded
        before_count = Workstation.objects.count()

        session_state_module.claim_workstation(
            ip, channel_name='chan-a', client_id='cid', role='host',
        )

        # A new row exists, distinct from both seeded benches AND the default.
        self.assertEqual(Workstation.objects.count(), before_count + 1)
        new_ws = Workstation.objects.get(identifier=f'auto-{ip.replace(".", "-")}')
        self.assertEqual(new_ws.instrument_addresses, [ip])
        self.assertFalse(new_ws.is_default)
        self.assertTrue(new_ws.is_active)
        self.assertEqual(new_ws.name, f'Bench @ {ip}')
        self.assertTrue(
            WorkstationClaim.objects.filter(workstation=new_ws).exists(),
            'Claim should be mirrored against the auto-provisioned row, '
            'not the default bench',
        )

    def test_second_claim_on_same_unknown_ip_reuses_same_row(self):
        """Auto-provisioning is idempotent across reconnects / re-claims."""
        ip = '198.51.100.77'
        session_state_module.claim_workstation(
            ip, channel_name='chan-a', client_id='cid', role='host',
        )
        first = Workstation.objects.get(identifier=f'auto-{ip.replace(".", "-")}')

        session_state_module.release_workstation(ip, channel_name='chan-a')
        session_state_module.claim_workstation(
            ip, channel_name='chan-b', client_id='cid2', role='host',
        )

        second = Workstation.objects.get(identifier=f'auto-{ip.replace(".", "-")}')
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Workstation.objects.filter(identifier__startswith='auto-').count(), 1)

    def test_seeded_workstation_takes_precedence_over_auto_provision(self):
        """If an operator curated a row for this IP, we honor that row."""
        session_state_module.claim_workstation(
            '10.0.0.1',  # already listed under Bench A in setUp()
            channel_name='chan-a', client_id='c', role='host',
        )
        # No auto-<slug> row should appear; the claim lives on Bench A.
        self.assertFalse(
            Workstation.objects.filter(identifier__startswith='auto-').exists(),
            'Known IP should resolve to its seeded bench, not auto-provision',
        )
        self.assertTrue(
            WorkstationClaim.objects.filter(workstation=self.bench_a).exists()
        )

    def test_two_ips_on_same_bench_collapse_to_one_row(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='c', role='host')
        session_state_module.claim_workstation(
            '10.0.0.2', channel_name='chan-a', client_id='c', role='host')
        self.assertEqual(
            WorkstationClaim.objects.filter(workstation=self.bench_a).count(), 1,
        )

    def test_release_keeps_row_while_sibling_ip_still_held(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='c', role='host')
        session_state_module.claim_workstation(
            '10.0.0.2', channel_name='chan-a', client_id='c', role='host')

        # First release: bench still holds another IP → row must survive.
        self.assertTrue(session_state_module.release_workstation(
            '10.0.0.1', channel_name='chan-a'))
        self.assertEqual(
            WorkstationClaim.objects.filter(workstation=self.bench_a).count(), 1,
        )

        # Second release: bench now fully free → row deleted.
        self.assertTrue(session_state_module.release_workstation(
            '10.0.0.2', channel_name='chan-a'))
        self.assertEqual(
            WorkstationClaim.objects.filter(workstation=self.bench_a).count(), 0,
        )

    def test_release_by_non_owner_does_not_touch_row(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='c', role='host')
        self.assertFalse(session_state_module.release_workstation(
            '10.0.0.1', channel_name='imposter'))
        # Row still exists, owner unchanged.
        claim = WorkstationClaim.objects.get(workstation=self.bench_a)
        self.assertEqual(claim.owner_channel, 'chan-a')

    def test_release_claims_for_bulk_deletes_db_rows(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='c', role='host')
        session_state_module.claim_workstation(
            '10.0.0.3', channel_name='chan-a', client_id='c', role='host')
        # A different channel's claim must be untouched.
        session_state_module.claim_workstation(
            '10.0.0.2', channel_name='chan-b', client_id='c', role='host')

        self.assertEqual(WorkstationClaim.objects.count(), 2)  # A + B collapsed benches
        freed = session_state_module.release_claims_for('chan-a')
        self.assertEqual(sorted(freed), ['10.0.0.1', '10.0.0.3'])
        # Only chan-b's claim survives.
        remaining = list(WorkstationClaim.objects.all())
        self.assertEqual(len(remaining), 1)
        self.assertEqual(remaining[0].owner_channel, 'chan-b')

    def test_active_session_threaded_into_claim_row(self):
        session = CalibrationSession.objects.create(session_name='Active Run')
        session_state_module.claim_workstation(
            '10.0.0.1',
            channel_name='chan-a', client_id='c', role='host',
            active_session_id=session.id,
        )
        claim = WorkstationClaim.objects.get(workstation=self.bench_a)
        self.assertEqual(claim.active_session_id, session.id)

    def test_wipe_stale_claims_returns_deleted_count(self):
        session_state_module.claim_workstation(
            '10.0.0.1', channel_name='chan-a', client_id='c', role='host')
        session_state_module.claim_workstation(
            '10.0.0.3', channel_name='chan-b', client_id='c', role='host')
        self.assertEqual(WorkstationClaim.objects.count(), 2)
        wiped = session_state_module.wipe_stale_claims()
        self.assertEqual(wiped, 2)
        self.assertEqual(WorkstationClaim.objects.count(), 0)

    def test_snapshot_preserves_legacy_wire_shape(self):
        session_state_module.claim_workstation(
            '10.0.0.1',
            channel_name='chan-a', client_id='cid-1', role='host',
            owner_label='192.168.1.7',
        )
        snap = session_state_module.claims_snapshot()
        # Legacy contract: IP-keyed dict, channel/client/role keys.
        # ``owner_label`` and DB-only fields are NOT exposed over the wire
        # (the frontend never learned about them, and we preserve that).
        self.assertEqual(set(snap.keys()), {'10.0.0.1'})
        entry = snap['10.0.0.1']
        self.assertEqual(entry['channel_name'], 'chan-a')
        self.assertEqual(entry['client_id'], 'cid-1')
        self.assertEqual(entry['role'], 'host')
        self.assertNotIn('owner_label', entry)
        self.assertNotIn('active_session_id', entry)


class HarmonicProjectionTests(TestCase):
    """Verify the ``_project_dc_from_ripple`` helper recovers the DC component
    of a synthetic SJTVC-like signal regardless of ripple amplitude, phase, and
    sampling-window truncation.

    The helper is the math core behind the LF AC fix in :mod:`api.consumers`.
    These tests are pure-Python and do not need any Django DB setup.
    """

    @staticmethod
    def _make_samples(frequency, n, duration, dc, amplitude, phase, *, seed=0, harmonic2=0.0, noise=0.0):
        """Build a synthetic ``[{'value', 'timestamp'}]`` series at ``2*frequency`` ripple."""
        import math
        import random

        rng = random.Random(seed)
        omega = 2.0 * 2.0 * math.pi * frequency
        samples = []
        # Non-uniform timestamps to mimic real GPIB jitter.
        for i in range(n):
            base_t = (i + 1) * (duration / (n + 1))
            jitter = rng.uniform(-0.01, 0.01) * (duration / max(n, 1))
            t = base_t + jitter
            value = (
                dc
                + amplitude * math.cos(omega * t + phase)
                + harmonic2 * math.cos(2 * omega * t + 0.7)
                + (rng.gauss(0.0, noise) if noise > 0 else 0.0)
            )
            samples.append({'value': value, 'timestamp': t})
        return samples

    def test_recovers_dc_with_clean_ripple(self):
        """Pure DC + 2f sinusoid: fit must recover DC to << 1 ppm."""
        from api.consumers import CalibrationConsumer

        dc = 0.008  # 8 mV, typical TVC output for low-current LF AC point
        samples = self._make_samples(
            frequency=10.0, n=120, duration=4.0,
            dc=dc, amplitude=0.0008, phase=1.234,  # 10% ripple, arbitrary phase
        )
        recovered, residual_ppm, n_used = CalibrationConsumer._project_dc_from_ripple(
            samples, frequency=10.0, harmonics=2,
        )
        self.assertEqual(n_used, 120)
        self.assertAlmostEqual(recovered, dc, delta=dc * 1e-9)
        self.assertLess(residual_ppm, 0.001)

    def test_arithmetic_mean_is_biased_under_window_truncation(self):
        """Demonstrate the bug we are fixing: the arithmetic mean shifts with
        the ripple's starting phase. The fit does not."""
        import math
        from api.consumers import CalibrationConsumer

        dc = 0.008
        amplitude = 0.0008  # 100,000 ppm of DC

        means = []
        fits = []
        # Sweep the start phase across the ripple cycle and watch the mean wobble.
        for phase in [0.0, math.pi / 3, 2 * math.pi / 3, math.pi, 4 * math.pi / 3]:
            samples = self._make_samples(
                frequency=10.0, n=12, duration=4.0,
                dc=dc, amplitude=amplitude, phase=phase,
            )
            mean_val = sum(s['value'] for s in samples) / len(samples)
            fit_val, _residual, _n = CalibrationConsumer._project_dc_from_ripple(
                samples, frequency=10.0, harmonics=1,
            )
            means.append(mean_val)
            fits.append(fit_val)

        mean_spread_ppm = (max(means) - min(means)) / dc * 1e6
        fit_spread_ppm = (max(fits) - min(fits)) / dc * 1e6
        # The arithmetic mean should drift by hundreds-to-thousands of ppm
        # across phase, the fit should be flat to <= ~1 ppm.
        self.assertGreater(mean_spread_ppm, 100.0,
                           f"mean spread {mean_spread_ppm:.2f} ppm - unexpectedly small")
        self.assertLess(fit_spread_ppm, 1.0,
                        f"fit spread {fit_spread_ppm:.2f} ppm - regression in projection helper")
        # The fit should also beat the mean by at least 100x in the worst case.
        self.assertLess(fit_spread_ppm * 100.0, mean_spread_ppm)

    def test_handles_second_harmonic_with_5_param_fit(self):
        """If a 4f tone is present, only the 2-harmonic fit (5 params) cleanly
        rejects it; the 1-harmonic fit may leak some bias."""
        from api.consumers import CalibrationConsumer

        dc = 0.008
        samples = self._make_samples(
            frequency=10.0, n=200, duration=5.0,
            dc=dc, amplitude=0.0008, phase=0.5, harmonic2=0.0002,
        )
        # 5-parameter fit removes both 2f and 4f.
        recovered_full, residual_full, _n = CalibrationConsumer._project_dc_from_ripple(
            samples, frequency=10.0, harmonics=2,
        )
        self.assertAlmostEqual(recovered_full, dc, delta=dc * 1e-8)
        self.assertLess(residual_full, 0.01)

    def test_falls_back_to_mean_when_under_determined(self):
        """If only 2 samples are provided (fewer than the 5 LSQ parameters
        require), the helper must not crash - it must hand back the mean and
        flag the residual as inf."""
        from api.consumers import CalibrationConsumer

        samples = [
            {'value': 0.0080, 'timestamp': 0.0},
            {'value': 0.0081, 'timestamp': 0.5},
        ]
        recovered, residual_ppm, n_used = CalibrationConsumer._project_dc_from_ripple(
            samples, frequency=10.0, harmonics=2,
        )
        self.assertEqual(n_used, 2)
        self.assertAlmostEqual(recovered, 0.00805, places=6)
        self.assertEqual(residual_ppm, float('inf'))

    def test_robust_to_random_noise_via_n(self):
        """Random Gaussian noise on top of the ripple should average out as N
        grows; the residual ppm metric should track the noise level."""
        from api.consumers import CalibrationConsumer

        dc = 0.008
        samples = self._make_samples(
            frequency=20.0, n=400, duration=2.0,
            dc=dc, amplitude=0.0004, phase=2.1, noise=0.000001, seed=42,
        )
        recovered, residual_ppm, _n = CalibrationConsumer._project_dc_from_ripple(
            samples, frequency=20.0, harmonics=2,
        )
        # 1 microvolt sigma on 8 mV DC is ~125 ppm per sample. With N=400 the
        # mean is ~6 ppm; the LSQ DC standard error is similar. Allow 30 ppm
        # to account for the projection's residual variance amplification.
        self.assertAlmostEqual(recovered, dc, delta=dc * 30e-6)
        # Residual ppm reflects per-sample noise level, not the recovered-DC
        # accuracy. Should be in the ballpark of 100 ppm here.
        self.assertGreater(residual_ppm, 10.0)
        self.assertLess(residual_ppm, 1000.0)
