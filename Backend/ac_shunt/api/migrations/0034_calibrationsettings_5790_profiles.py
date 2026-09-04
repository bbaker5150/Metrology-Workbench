from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("api", "0033_calibrationsession_reader_switch")]

    operations = [
        migrations.AlterField(
            model_name="calibrationsession",
            name="standard_reader_input",
            field=models.CharField(blank=True, max_length=6, null=True),
        ),
        migrations.AlterField(
            model_name="calibrationsession",
            name="test_reader_input",
            field=models.CharField(blank=True, max_length=6, null=True),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f5790_filter_mode",
            field=models.CharField(default="FAST", max_length=10),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f5790_filter_restart",
            field=models.CharField(default="COARSE", max_length=10),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f5790_hires_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f5790_range_mode",
            field=models.CharField(default="POINT", max_length=8),
        ),
        migrations.AddField(
            model_name="calibrationsettings",
            name="f5790_input_switch_settling_time",
            field=models.FloatField(
                default=1.0,
                help_text="Delay after switching INPUT1/INPUT2 on a shared 5790A/B.",
            ),
        ),
    ]
