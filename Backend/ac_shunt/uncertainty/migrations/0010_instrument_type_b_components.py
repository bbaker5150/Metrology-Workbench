# Generated for the instrument-associated Type B uncertainty feature.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("uncertainty", "0009_testpoint_variable_nominals"),
    ]

    operations = [
        migrations.AddField(
            model_name="instrument",
            name="type_b_components",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
