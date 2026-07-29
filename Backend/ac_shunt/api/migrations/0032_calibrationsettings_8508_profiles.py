from django.db import migrations, models


def initialize_8508_smart_defaults(apps, schema_editor):
    CalibrationSettings = apps.get_model("api", "CalibrationSettings")
    for settings in CalibrationSettings.objects.select_related("test_point"):
        frequency = abs(float(getattr(settings.test_point, "frequency", 0) or 0))
        if frequency < 40:
            settings.f8508_ac_filter_hz = 10
            settings.f8508_ac_dc_coupled = True
            recommended_delay = 12.5
        elif frequency < 100:
            settings.f8508_ac_filter_hz = 40
            settings.f8508_ac_dc_coupled = False
            recommended_delay = 5.0
        else:
            settings.f8508_ac_filter_hz = 100
            settings.f8508_ac_dc_coupled = False
            recommended_delay = 5.0
        settings.input_switch_settling_time = recommended_delay
        settings.save(update_fields=[
            "f8508_ac_filter_hz",
            "f8508_ac_dc_coupled",
            "input_switch_settling_time",
        ])


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0031_calibrationsession_8508_inputs"),
    ]

    operations = [
        migrations.AddField(
            model_name="calibrationsettings",
            name="input_switch_settling_time",
            field=models.FloatField(
                blank=True,
                help_text="Operator-selected 8508A FRONT/REAR switch delay in seconds.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_dc_filter_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_dc_resolution",
            field=models.PositiveSmallIntegerField(default=7),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_dc_fast_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_ac_filter_hz",
            field=models.PositiveSmallIntegerField(default=100),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_ac_resolution",
            field=models.PositiveSmallIntegerField(default=6),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_ac_transfer_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f8508_ac_dc_coupled",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(
            initialize_8508_smart_defaults,
            migrations.RunPython.noop,
        ),
    ]
