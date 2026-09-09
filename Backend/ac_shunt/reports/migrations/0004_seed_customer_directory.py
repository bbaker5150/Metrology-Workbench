"""Initialize directory metadata and optionally seed a locally bundled address list."""
import gzip
import json
from pathlib import Path
from django.db import migrations


def seed_directory(apps, schema_editor):
    Customer = apps.get_model('reports', 'Customer')
    Directory = apps.get_model('reports', 'CustomerDirectory')
    alias = schema_editor.connection.alias
    if Directory.objects.using(alias).filter(pk=1).exists():
        return
    seed = Path(__file__).parent.parent / 'data' / 'customers_initial.json.gz'
    rows = json.loads(gzip.decompress(seed.read_bytes())) if seed.exists() else []
    Customer.objects.using(alias).bulk_create([Customer(**row) for row in rows], batch_size=500)
    Directory.objects.using(alias).create(pk=1, source_name='Lab Address List.xlsx' if rows else 'No workbook imported', row_count=len(rows))


class Migration(migrations.Migration):
    dependencies = [('reports', '0003_customer_customerdirectory')]
    operations = [migrations.RunPython(seed_directory, migrations.RunPython.noop)]
