"""
Views for the Report of Calibration module.

Excel generation is self-contained (reports/excel.py, no external
dependency). AC-Shunt pull reads the api app's models in-process via
reports/services.py. ``/roc/parse/`` (re-importing a filled-in template
workbook) is still not built — the Excel Import tab's upload/parse flow will
404 until a later step adds it; downloading a template still works.
"""
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import excel as excel_builder
from . import models, serializers, services


@api_view(["GET"])
@permission_classes([AllowAny])
def module_info(request):
    """Report that the Report of Calibration backend is present and wired."""
    return Response({
        "module": "reports",
        "title": "Report of Calibration",
        "status": "ready",
    })


@api_view(["GET"])
@permission_classes([AllowAny])
def areas(request):
    qs = models.MeasurementArea.objects.all()
    return Response(serializers.MeasurementAreaSerializer(qs, many=True).data)


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def rocs(request):
    if request.method == "POST":
        serializer = serializers.ROCRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    qs = models.ROCRecord.objects.all()
    return Response(serializers.ROCRecordSerializer(qs, many=True).data)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([AllowAny])
def roc_detail(request, roc_id):
    record = get_object_or_404(models.ROCRecord, pk=roc_id)

    if request.method == "DELETE":
        record.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    if request.method == "PUT":
        serializer = serializers.ROCRecordSerializer(record, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    return Response(serializers.ROCRecordSerializer(record).data)


def _xlsx_response(workbook, filename):
    response = HttpResponse(
        excel_builder.workbook_to_bytes(workbook),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["POST"])
@permission_classes([AllowAny])
def roc_generate(request):
    """Generate a workbook straight from a manual-input payload (not saved)."""
    workbook = excel_builder.build_workbook(request.data)
    filename = f"ROC_{request.data.get('roc_number') or 'draft'}.xlsx"
    return _xlsx_response(workbook, filename)


@api_view(["GET"])
@permission_classes([AllowAny])
def roc_excel(request, roc_id):
    """Generate a workbook from a saved ROCRecord."""
    record = get_object_or_404(models.ROCRecord, pk=roc_id)
    workbook = excel_builder.build_workbook(serializers.ROCRecordSerializer(record).data)
    return _xlsx_response(workbook, f"ROC_{record.roc_number or record.pk}.xlsx")


@api_view(["GET"])
@permission_classes([AllowAny])
def roc_template(request):
    """Generate a blank workbook pre-filled with one area's default statements."""
    area_code = request.query_params.get("area", "")
    area = models.MeasurementArea.objects.filter(code=area_code).first()
    data = {
        "area_code": area_code,
        "nomenclature": area.default_nomenclature if area else "",
        "submitted_label": area.submitted_label if area else "Submitted by:",
        "statements": area.statements if area else [],
    }
    workbook = excel_builder.build_workbook(data)
    return _xlsx_response(workbook, f"ROC_template_{area_code or 'blank'}.xlsx")


@api_view(["GET"])
@permission_classes([AllowAny])
def ac_shunt_sessions(request):
    return Response(services.list_ac_shunt_sessions())


@api_view(["GET"])
@permission_classes([AllowAny])
def ac_shunt_session_pull(request, session_id):
    payload = services.pull_ac_shunt_session(session_id)
    if payload is None:
        return Response({"error": "Calibration session not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(payload)
