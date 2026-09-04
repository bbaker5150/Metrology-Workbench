"""
DRF serializers for the Report of Calibration module.

Both models are flat enough (regular columns + a few JSON blobs) that plain
``ModelSerializer``s suffice — no hand-rolled DTO functions needed like the
``uncertainty`` app's deeply-nested sessions.
"""
from rest_framework import serializers

from .models import ROCRecord


class ROCRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = ROCRecord
        fields = "__all__"
