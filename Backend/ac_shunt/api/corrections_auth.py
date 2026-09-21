"""Server-side authorization for imported correction data; no built-in password."""
import hashlib
import os
import secrets
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import check_password, identify_hasher
from django.core.cache import cache
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_variables
from rest_framework import serializers
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import Shunt, TVC

TOKEN_SECONDS = 600
PASSWORD_ENV = 'AC_SHUNT_CORRECTIONS_PASSWORD_HASH'


class AuthorizationUnavailable(APIException):
    status_code = 503
    default_detail = 'Imported-data authorization is not configured. Ask the administrator to run configure_corrections_password on the backend.'


def password_file():
    return Path(settings.CREDENTIALS_DIR) / 'corrections-admin-password.hash'


def configured_hash():
    encoded = os.environ.get(PASSWORD_ENV, '').strip()
    if not encoded:
        try:
            encoded = password_file().read_text(encoding='utf-8').strip()
        except (OSError, AttributeError):
            raise AuthorizationUnavailable() from None
    try:
        identify_hasher(encoded)
    except ValueError:
        raise AuthorizationUnavailable() from None
    return encoded


def device_scope(device):
    return f'{device._meta.model_name}:{device.pk}'


def token_key(token):
    return 'corrections-grant:' + hashlib.sha256(token.encode()).hexdigest()


def fingerprint(encoded):
    return hashlib.sha256(encoded.encode()).hexdigest()


def require_corrections_authorization(request, device):
    if device.is_manual:
        return
    encoded = configured_hash()
    parts = request.headers.get('Authorization', '').split()
    token = parts[1] if len(parts) == 2 and parts[0] == 'Corrections' else ''
    grant = cache.get(token_key(token)) if 0 < len(token) <= 128 else None
    if grant != {'scope': device_scope(device), 'config': fingerprint(encoded)}:
        raise PermissionDenied('Authorization expired or missing. Enter the imported-data password again.')


class PasswordAttemptThrottle(SimpleRateThrottle):
    rate = '5/min'

    def get_cache_key(self, request, view):
        return 'corrections-password-attempt:' + self.get_ident(request)


class AuthorizationRequestSerializer(serializers.Serializer):
    device_type = serializers.ChoiceField(choices=['shunt', 'tvc'])
    device_id = serializers.IntegerField(min_value=1, max_value=9223372036854775807)
    password = serializers.CharField(trim_whitespace=False, max_length=256, write_only=True)


@method_decorator(sensitive_variables('password', 'encoded', 'token'), name='post')
class CorrectionsAuthorizationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PasswordAttemptThrottle]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store'
        return response

    def post(self, request):
        # This JSON endpoint never logs or echoes submitted credentials.
        payload = AuthorizationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        model = {'shunt': Shunt, 'tvc': TVC}[payload.validated_data['device_type']]
        device = get_object_or_404(model, pk=payload.validated_data['device_id'])
        encoded = configured_hash()
        password = payload.validated_data['password']
        try:
            valid = check_password(password, encoded)
        except (ValueError, TypeError, AssertionError):
            raise AuthorizationUnavailable() from None
        if not valid:
            raise PermissionDenied('Incorrect password. Access denied.')
        # Opaque, device-scoped grants avoid trusting the app's legacy Django
        # signing key. Password rotation invalidates every outstanding grant.
        token = secrets.token_urlsafe(32)
        cache.set(token_key(token), {'scope': device_scope(device), 'config': fingerprint(encoded)}, TOKEN_SECONDS)
        response = Response({'token': token, 'expires_in': TOKEN_SECONDS})
        response['Cache-Control'] = 'no-store'
        return response
