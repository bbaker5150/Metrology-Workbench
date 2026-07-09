from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("uncertainty", "0010_instrument_type_b_components"),
    ]

    operations = [
        migrations.AddField(
            model_name="manualcomponent",
            name="extra",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
