from django.core.management.base import BaseCommand
from uncertainty.ac_shunt_instruments import seed_ac_shunt_references, seed_ac_shunt_test_instruments


class Command(BaseCommand):
    help = 'Create missing shunt standards and TIs, and apply the conventional library names once; preserve uncertainty definitions.'

    def handle(self, *args, **options):
        count = seed_ac_shunt_references()
        ti_count = seed_ac_shunt_test_instruments()
        self.stdout.write(self.style.SUCCESS(f'Created {count} standard instruments and {ti_count} TIs; library names updated and uncertainty definitions preserved.'))
