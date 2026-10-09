from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("uncertainty", "0017_session_instrument_onboarding")]

    operations = [
        migrations.AddField(
            model_name="session", name="qualifier_column_names",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="instrument", name="local_override",
            field=models.BooleanField(default=False),
        ),
    ]
