from django.core.management.base import BaseCommand
from uncertainty.ac_shunt_instruments import seed_ac_shunt_references, seed_ac_shunt_test_instruments


class Command(BaseCommand):
    help = 'Create missing Uncertalytics reference and TI instruments from saved AC-shunt data; preserve existing definitions.'

    def handle(self, *args, **options):
        count = seed_ac_shunt_references()
        ti_count = seed_ac_shunt_test_instruments()
        self.stdout.write(self.style.SUCCESS(f'Created {count} reference instruments and {ti_count} TIs; existing definitions preserved.'))
