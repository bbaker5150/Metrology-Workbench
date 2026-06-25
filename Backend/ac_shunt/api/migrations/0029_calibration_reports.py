"""Introduce dated Reports of Calibration for Shunt and TVC devices.

This first migration is purely additive so it can run safely against a
populated database: it creates the ``ShuntReport`` / ``TVCReport`` tables,
adds nullable ``report`` / ``current`` columns to the correction tables,
and then backfills a single "legacy baseline" report per device that owns
all of that device's existing corrections. ``0030`` finalizes the schema
(drops the old foreign keys, merges duplicate shunts, tightens the
constraints).
"""
from collections import defaultdict

import django.db.models.deletion
from django.db import migrations, models


def populate_reports(apps, schema_editor):
    Shunt = apps.get_model('api', 'Shunt')
    ShuntReport = apps.get_model('api', 'ShuntReport')
    ShuntCorrection = apps.get_model('api', 'ShuntCorrection')
    TVC = apps.get_model('api', 'TVC')
    TVCReport = apps.get_model('api', 'TVCReport')
    TVCCorrection = apps.get_model('api', 'TVCCorrection')

    baseline_note = 'Imported baseline (pre-history). Date unknown.'

    # --- Shunts -----------------------------------------------------------
    # The old schema keyed a Shunt by (serial, range, current, is_manual),
    # so one physical serial appears as several rows (one per input
    # current). Collapse each (serial, range, is_manual) group into a single
    # device + one baseline report, and move every correction's input
    # current onto the correction row.
    groups = defaultdict(list)
    for shunt in Shunt.objects.all().order_by('id'):
        groups[(shunt.serial_number, shunt.range, shunt.is_manual)].append(shunt)

    for shunts in groups.values():
        canonical = shunts[0]
        report = ShuntReport.objects.create(
            shunt=canonical,
            calibration_date=None,
            report_number='',
            received_date=None,
            notes=baseline_note,
            is_active=True,
            is_pinned=False,
        )
        for shunt in shunts:
            for corr in ShuntCorrection.objects.filter(shunt=shunt):
                corr.report = report
                corr.current = shunt.current
                corr.save(update_fields=['report', 'current'])

    # --- TVCs -------------------------------------------------------------
    # A TVC is already one device per serial, so just give each one a
    # baseline report that owns its existing corrections.
    for tvc in TVC.objects.all().order_by('id'):
        report = TVCReport.objects.create(
            tvc=tvc,
            calibration_date=None,
            report_number='',
            received_date=None,
            notes=baseline_note,
            is_active=True,
            is_pinned=False,
        )
        TVCCorrection.objects.filter(tvc=tvc).update(report=report)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0028_calibrationrunlock'),
    ]

    operations = [
        migrations.CreateModel(
            name='ShuntReport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('calibration_date', models.DateField(blank=True, help_text='Date printed on the Report of Calibration. Drives which report is active.', null=True)),
                ('report_number', models.CharField(blank=True, default='', max_length=120)),
                ('received_date', models.DateField(blank=True, help_text='Date the certificate was received in the lab (optional, informational).', null=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('is_active', models.BooleanField(default=False, help_text='Materialized flag: the single report whose values feed live calibration math.')),
                ('is_pinned', models.BooleanField(default=False, help_text='Operator override: force this report active even if a newer-dated one exists.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('shunt', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reports', to='api.shunt')),
            ],
            options={'ordering': ['-calibration_date', '-created_at']},
        ),
        migrations.CreateModel(
            name='TVCReport',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('calibration_date', models.DateField(blank=True, help_text='Date printed on the Report of Calibration. Drives which report is active.', null=True)),
                ('report_number', models.CharField(blank=True, default='', max_length=120)),
                ('received_date', models.DateField(blank=True, help_text='Date the certificate was received in the lab (optional, informational).', null=True)),
                ('notes', models.TextField(blank=True, default='')),
                ('is_active', models.BooleanField(default=False, help_text='Materialized flag: the single report whose values feed live calibration math.')),
                ('is_pinned', models.BooleanField(default=False, help_text='Operator override: force this report active even if a newer-dated one exists.')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('tvc', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reports', to='api.tvc')),
            ],
            options={'ordering': ['-calibration_date', '-created_at']},
        ),
        migrations.AddField(
            model_name='shuntcorrection',
            name='report',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='corrections', to='api.shuntreport'),
        ),
        migrations.AddField(
            model_name='shuntcorrection',
            name='current',
            field=models.FloatField(null=True),
        ),
        migrations.AddField(
            model_name='tvccorrection',
            name='report',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.CASCADE, related_name='corrections', to='api.tvcreport'),
        ),
        migrations.RunPython(populate_reports, migrations.RunPython.noop),
    ]
