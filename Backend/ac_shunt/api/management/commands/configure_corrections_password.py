"""Set a server-only hash without putting a password on the command line."""
import getpass
import os
import warnings

from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from api.corrections_auth import PASSWORD_ENV, password_file


class Command(BaseCommand):
    help = 'Configure the imported-corrections password using a hidden interactive prompt.'
    requires_system_checks = []

    def handle(self, *args, **options):
        if os.environ.get(PASSWORD_ENV):
            raise CommandError(f'{PASSWORD_ENV} is set; update that server environment value instead of the file.')
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                password = getpass.getpass('Imported-corrections password: ')
                confirmation = getpass.getpass('Confirm password: ')
        except (getpass.GetPassWarning, EOFError):
            raise CommandError('Run this command in an interactive terminal that supports hidden password input.') from None
        if not password or len(password) > 256 or password != confirmation:
            raise CommandError('Passwords must match and contain between 1 and 256 characters.')
        target = password_file()
        target.parent.mkdir(parents=True, exist_ok=True)
        # A temporary file in the same folder makes password rotation atomic.
        import tempfile
        fd, temporary = tempfile.mkstemp(prefix='.corrections-password-', dir=target.parent)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(make_password(password) + '\n')
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.stdout.write(self.style.SUCCESS('Imported-corrections password configured. No plaintext password was stored.'))
