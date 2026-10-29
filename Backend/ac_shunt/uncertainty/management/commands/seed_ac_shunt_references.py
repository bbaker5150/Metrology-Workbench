from django.core.management.base import BaseCommand
from uncertainty.ac_shunt_instruments import catalog_record, seed_ac_shunt_references, seed_ac_shunt_test_instruments, shunt_catalog
from uncertainty.ac_shunt_library_cleanup import remove_unsupported_generated_instruments
from uncertainty.ac_shunt_roles import consolidate_library_roles
from uncertainty.fluke5790_instrument import seed_generic_5790


class Command(BaseCommand):
    help = 'Create one library entry per shunt correction set, consolidate TI copies, and label manual corrections.'

    def handle(self, *args, **options):
        _, reader_created = seed_generic_5790()
        if reader_created:
            self.stdout.write('Created generic Fluke 5790B with voltage resolution; no serial number.')
        count = seed_ac_shunt_references()
        consolidated, role_backup = consolidate_library_roles(seed_ac_shunt_test_instruments(export_only=True))
        removed, backup = remove_unsupported_generated_instruments([catalog_record(*row) for row in shunt_catalog()])
        self.stdout.write(self.style.SUCCESS(f'Created {count} shunt instruments; reference uncertainties and TI acceptance limits retained in one entry.'))
        if consolidated:
            self.stdout.write(f'Consolidated {consolidated} TI copies. Backup: {role_backup}. Saved budgets unchanged.')
        if removed:
            self.stdout.write(f'Removed {removed} unsupported generated entries/local copies. Backup: {backup}. Saved budgets unchanged.')
