from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("uncertainty", "0014_session_detail_section_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="session",
            name="detail_collapsed_sections",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
