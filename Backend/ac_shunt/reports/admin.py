from django.contrib import admin

from .models import ROCRecord


@admin.register(ROCRecord)
class ROCRecordAdmin(admin.ModelAdmin):
    list_display = ["roc_number", "nomenclature", "area_name", "calibration_date", "updated_at"]
    search_fields = ["roc_number", "nomenclature", "serial_number"]
    list_filter = ["area_code"]
