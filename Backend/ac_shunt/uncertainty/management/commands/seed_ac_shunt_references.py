from django.core.management.base import BaseCommand
from uncertainty.ac_shunt_instruments import catalog_record, seed_ac_shunt_references, seed_ac_shunt_test_instruments, shunt_catalog
from uncertainty.ac_shunt_library_cleanup import remove_unsupported_generated_instruments


class Command(BaseCommand):
    help = 'Create missing shunt standards and TIs, and apply the conventional library names once; preserve uncertainty definitions.'

    def handle(self, *args, **options):
        count = seed_ac_shunt_references()
        ti_count = seed_ac_shunt_test_instruments()
        removed, backup = remove_unsupported_generated_instruments([catalog_record(*row) for row in shunt_catalog()])
        self.stdout.write(self.style.SUCCESS(f'Created {count} standard instruments and {ti_count} TIs; library names updated and uncertainty definitions preserved.'))
        if removed:
            self.stdout.write(f'Removed {removed} unsupported generated entries/local copies. Backup: {backup}. Saved budgets unchanged.')
