from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("uncertainty", "0015_session_detail_collapsed_sections")]
    operations = [
        migrations.AddField(model_name="session", name="measurement_area_groups",
                            field=models.JSONField(blank=True, default=None, null=True)),
        migrations.AddField(model_name="uut", name="measurement_area_names",
                            field=models.JSONField(blank=True, default=None, null=True)),
        migrations.AddField(model_name="sessiontmde", name="measurement_area_names",
                            field=models.JSONField(blank=True, default=None, null=True)),
    ]
