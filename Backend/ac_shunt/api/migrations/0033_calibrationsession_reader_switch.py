from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0032_calibrationsettings_8508_profiles"),
    ]

    operations = [
        migrations.AddField(
            model_name="calibrationsession",
            name="reader_switch_driver_address",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="calibrationsession",
            name="reader_switch_driver_model",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="calibrationsession",
            name="reader_switch_driver_serial",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
        migrations.AddField(
            model_name="calibrationsession",
            name="reader_switch_standard_route",
            field=models.CharField(
                choices=[("OPEN", "Open / NC"), ("CLOSED", "Closed / NO")],
                default="OPEN",
                max_length=6,
            ),
        ),
        migrations.AddField(
            model_name="calibrationsession",
            name="reader_switch_settling_time",
            field=models.FloatField(default=1.0),
        ),
    ]
