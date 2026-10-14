from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("uncertainty", "0018_qualifier_names_and_local_override")]

    operations = [
        migrations.AddField(
            model_name="instrument", name="column_metadata",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
