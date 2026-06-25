"""Finalize the Reports-of-Calibration schema.

Runs after ``0029`` has backfilled a baseline report per device. Drops the
legacy ``shunt``/``tvc`` foreign keys from the correction tables, deletes
the now-redundant duplicate Shunt rows that were merged into a canonical
device, removes ``Shunt.current`` (now carried per correction), and
tightens the not-null / unique constraints.
"""
import django.db.models.deletion
from django.db import migrations, models


def delete_merged_shunts(apps, schema_editor):
    """Remove duplicate Shunt rows left over after the 0029 merge.

    0029 created exactly one baseline report under the canonical row of each
    (serial, range, is_manual) group and repointed every correction onto it.
    The non-canonical duplicates therefore own no reports — and now that the
    old ``shunt`` FK is gone from corrections, deleting them is safe.
    """
    Shunt = apps.get_model('api', 'Shunt')
    Shunt.objects.filter(reports__isnull=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0029_calibration_reports'),
    ]

    operations = [
        # --- Drop legacy correction -> device foreign keys ---------------
        migrations.AlterUniqueTogether(
            name='shuntcorrection',
            unique_together=set(),
        ),
        migrations.RemoveField(
            model_name='shuntcorrection',
            name='shunt',
        ),
        migrations.AlterUniqueTogether(
            name='tvccorrection',
            unique_together=set(),
        ),
        migrations.RemoveField(
            model_name='tvccorrection',
            name='tvc',
        ),

        # --- Collapse merged duplicate shunts ----------------------------
        migrations.RunPython(delete_merged_shunts, migrations.RunPython.noop),

        # --- Tighten correction columns now that they're populated -------
        migrations.AlterField(
            model_name='shuntcorrection',
            name='report',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='corrections', to='api.shuntreport'),
        ),
        migrations.AlterField(
            model_name='shuntcorrection',
            name='current',
            field=models.FloatField(),
        ),
        migrations.AlterField(
            model_name='tvccorrection',
            name='report',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='corrections', to='api.tvcreport'),
        ),
        migrations.AlterUniqueTogether(
            name='shuntcorrection',
            unique_together={('report', 'current', 'frequency')},
        ),
        migrations.AlterUniqueTogether(
            name='tvccorrection',
            unique_together={('report', 'frequency')},
        ),

        # --- Re-key the Shunt device (drop per-current identity) ----------
        migrations.AlterUniqueTogether(
            name='shunt',
            unique_together=set(),
        ),
        migrations.RemoveField(
            model_name='shunt',
            name='current',
        ),
        migrations.AlterUniqueTogether(
            name='shunt',
            unique_together={('serial_number', 'range', 'is_manual')},
        ),
    ]
