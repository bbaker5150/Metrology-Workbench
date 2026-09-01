from django.contrib import admin

from .models import MeasurementArea, ROCRecord


@admin.register(MeasurementArea)
class MeasurementAreaAdmin(admin.ModelAdmin):
    list_display = ["code", "name", "default_nomenclature"]
    search_fields = ["code", "name"]


@admin.register(ROCRecord)
class ROCRecordAdmin(admin.ModelAdmin):
    list_display = ["roc_number", "nomenclature", "area_name", "calibration_date", "updated_at"]
    search_fields = ["roc_number", "nomenclature", "serial_number"]
    list_filter = ["area_code"]
