from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0030_finalize_calibration_reports"),
    ]

    operations = [
        migrations.AddField(
            model_name="calibrationsession",
            name="standard_reader_input",
            field=models.CharField(blank=True, max_length=5, null=True),
        ),
        migrations.AddField(
            model_name="calibrationsession",
            name="test_reader_input",
            field=models.CharField(blank=True, max_length=5, null=True),
        ),
    ]
