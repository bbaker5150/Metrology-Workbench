from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0034_calibrationsettings_5790_profiles"),
    ]

    operations = [
        migrations.AlterField(
            model_name="calibrationsettings",
            name="f5790_filter_mode",
            field=models.CharField(default="MEDIUM", max_length=10),
        ),
        migrations.AlterField(
            model_name="calibrationsettings",
            name="f5790_filter_restart",
            field=models.CharField(default="MEDIUM", max_length=10),
        ),
        migrations.AlterField(
            model_name="calibrationsettings",
            name="f5790_hires_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name="calibrationsettings",
            name="f5790_range_mode",
            field=models.CharField(default="AUTO", max_length=8),
        ),
        migrations.AlterField(
            model_name="calibrationsettings",
            name="f5790_input_switch_settling_time",
            field=models.FloatField(
                default=30.0,
                help_text="Delay after switching INPUT1/INPUT2 on a shared 5790A/B.",
            ),
        ),
    ]
