"""
Views for the Report of Calibration module.

Excel generation is self-contained (reports/excel.py, no external
dependency). AC-Shunt pull reads the api app's models in-process via
reports/services.py. ``/roc/parse/`` reads a filled-in copy of one of
excel.py's own templates back into a ROC payload (reports/importer.py) --
the Excel Import tab's upload flow.
"""
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import area_registry, excel as excel_builder
from . import importer
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
    return Response(area_registry.list_areas())


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
    workbook = excel_builder.build_download_workbook(request.data)
    filename = f"ROC_{request.data.get('roc_number') or 'draft'}.xlsx"
    return _xlsx_response(workbook, filename)


@api_view(["GET"])
@permission_classes([AllowAny])
def roc_excel(request, roc_id):
    """Generate a workbook from a saved ROCRecord."""
    record = get_object_or_404(models.ROCRecord, pk=roc_id)
    workbook = excel_builder.build_download_workbook(serializers.ROCRecordSerializer(record).data)
    return _xlsx_response(workbook, f"ROC_{record.roc_number or record.pk}.xlsx")


@api_view(["GET"])
@permission_classes([AllowAny])
def roc_template(request):
    """Generate the blank Data Entry form for one area (its defaults from
    areas/<code>.json) -- no certificate page, since there's no record yet
    to put on one. Fill it out in Excel and upload it back through Excel
    Import (/roc/parse/) to load it into a record."""
    area_code = request.query_params.get("area", "")
    data = area_registry.get_area(area_code)
    if data is None:
        return Response({"error": f"Unknown measurement area '{area_code}'."}, status=status.HTTP_404_NOT_FOUND)
    workbook = excel_builder.build_blank_template_workbook(data)
    return _xlsx_response(workbook, f"ROC_template_{area_code}.xlsx")


@api_view(["POST"])
@parser_classes([MultiPartParser])
@permission_classes([AllowAny])
def roc_parse(request):
    """Parse an uploaded ROC workbook (a filled-in template, or a real lab
    workbook) into a ROC payload for the Excel Import preview."""
    upload = request.FILES.get("file")
    if not upload:
        return Response({"error": "No file uploaded."}, status=status.HTTP_400_BAD_REQUEST)
    area_hint = request.data.get("area") or None
    try:
        data = importer.parse_workbook(upload, area_hint=area_hint)
    except importer.UnsupportedWorkbook as exc:
        return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response(data)


@api_view(["GET"])
@permission_classes([AllowAny])
def ac_shunt_sessions(request):
    return Response(services.list_ac_shunt_sessions(request.query_params))


@api_view(["GET"])
@permission_classes([AllowAny])
def ac_shunt_session_pull(request, session_id):
    payload = services.pull_ac_shunt_session(session_id)
    if payload is None:
        return Response({"error": "Calibration session not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(payload)


@api_view(["GET"])
@permission_classes([AllowAny])
def customer_search(request):
    from django.db.models import Q
    from django.core.paginator import Paginator
    from .customers import FIELDS
    customers = models.Customer.objects.all()
    for word in request.query_params.get("q", "").split():
        match = Q()
        for field in FIELDS:
            match |= Q(**{f"{field}__icontains": word})
        customers = customers.filter(match)
    page = Paginator(customers, 20).get_page(request.query_params.get("page", 1))
    directory = models.CustomerDirectory.objects.get(pk=1)
    return Response({"customers": list(page.object_list.values("id", *FIELDS)),
                     "total": page.paginator.count, "page": page.number, "pages": page.paginator.num_pages,
                     "directory": {"source_name": directory.source_name, "row_count": directory.row_count,
                                   "updated_at": directory.updated_at}})


@api_view(["POST"])
@permission_classes([AllowAny])
@parser_classes([MultiPartParser])
def customer_import(request):
    from .customers import parse_customers, replace_customers
    from openpyxl.utils.exceptions import InvalidFileException
    from xml.etree.ElementTree import ParseError
    upload = request.FILES.get("file")
    if upload is None:
        return Response({"error": "Choose an Excel workbook."}, status=400)
    try:
        rows, duplicates = parse_customers(upload)
    except (ValueError, InvalidFileException, ParseError, EOFError) as exc:
        return Response({"error": str(exc)}, status=400)
    directory = replace_customers(rows, upload.name)
    return Response({"imported": directory.row_count, "duplicates_skipped": duplicates,
                     "missing_addresses": sum(not row["address"] for row in rows),
                     "source_name": directory.source_name})
