from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("uncertainty", "0013_testpoint_risk8_monte_carlo"),
    ]

    operations = [
        migrations.AddField(
            model_name="session",
            name="detail_section_order",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
