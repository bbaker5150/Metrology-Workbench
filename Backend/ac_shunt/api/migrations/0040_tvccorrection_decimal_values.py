from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('api', '0039_alter_calibrationresults_outlier_filter_mode')]

    operations = [
        migrations.AlterField(
            model_name='tvccorrection', name='ac_dc_difference', field=models.FloatField(),
        ),
        migrations.AlterField(
            model_name='tvccorrection', name='expanded_uncertainty', field=models.FloatField(),
        ),
    ]
