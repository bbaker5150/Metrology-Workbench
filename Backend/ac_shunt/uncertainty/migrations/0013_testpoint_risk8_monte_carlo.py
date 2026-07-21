from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("uncertainty", "0012_testpoint_equation_name"),
    ]

    operations = [
        migrations.AddField(
            model_name="testpoint",
            name="budget_propagation_method",
            field=models.CharField(blank=True, default="", max_length=24),
        ),
        migrations.AddField(
            model_name="testpoint",
            name="monte_carlo_trials",
            field=models.PositiveIntegerField(default=10000),
        ),
        migrations.AddField(
            model_name="testpoint",
            name="risk8_monte_carlo_result",
            field=models.JSONField(blank=True, default=dict, null=True),
        ),
    ]
