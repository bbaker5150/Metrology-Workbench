from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("uncertainty", "0016_measurement_area_organization")]
    operations = [migrations.AddField(
        model_name="session", name="instrument_onboarding",
        field=models.JSONField(default=dict, blank=True),
    )]
