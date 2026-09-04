import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0036_use_physical_5790_ranges'),
    ]

    operations = [
        migrations.AddField(
            model_name='calibrationresults',
            name='corrections_manually_overridden',
            field=models.BooleanField(
                default=False,
                help_text='True when the operator saved correction factors from the calculation view; automatic report lookups must then preserve them.',
            ),
        ),
        migrations.AddField(
            model_name='testpoint',
            name='correction_report',
            field=models.ForeignKey(
                blank=True,
                help_text='The exact AC-shunt Report of Calibration used when this point was generated. Legacy points may leave this blank.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='test_points',
                to='api.shuntreport',
            ),
        ),
    ]
