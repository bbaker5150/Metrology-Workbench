from django.core.management.base import BaseCommand
from uncertainty.ac_shunt_instruments import seed_ac_shunt_references


class Command(BaseCommand):
    help = 'Create missing Uncertalytics NIST reference instruments from saved AC-shunt reports; preserve existing definitions.'

    def handle(self, *args, **options):
        count = seed_ac_shunt_references()
        self.stdout.write(self.style.SUCCESS(f'Created {count} reference instruments; existing definitions preserved.'))
