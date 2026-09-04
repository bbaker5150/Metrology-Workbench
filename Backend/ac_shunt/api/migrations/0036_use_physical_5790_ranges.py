from django.db import migrations, models


def migrate_legacy_range_modes(apps, schema_editor):
    CalibrationSettings = apps.get_model("api", "CalibrationSettings")
    CalibrationSettings.objects.filter(f5790_range_mode__in=("AUTO", "POINT")).update(
        f5790_range_mode="2.2"
    )


class Migration(migrations.Migration):
    dependencies = [("api", "0035_update_5790_profile_defaults")]

    operations = [
        migrations.RunPython(migrate_legacy_range_modes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="calibrationsettings",
            name="f5790_range_mode",
            field=models.CharField(default="2.2", max_length=8),
        ),
    ]
