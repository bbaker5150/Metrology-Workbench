# api/views.py
import pyvisa
import socket
from django.http import JsonResponse
from rest_framework.decorators import api_view
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.conf import settings
from django.db import transaction
from django.core.exceptions import ObjectDoesNotExist
import json
import os
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync

from .models import (
    Message, CalibrationSession, TestPoint, TestPointSet, Calibration,
    CalibrationConfigurations, CalibrationTVCCorrections, CalibrationSettings,
    CalibrationReadings, CalibrationResults, Shunt, ShuntReport, TVC, TVCReport,
    BugReport, Workstation,
)
from .serializers import (
    MessageSerializer, CalibrationSerializer, CalibrationSessionSerializer,
    TestPointSerializer, TestPointSetSerializer,
    CalibrationTVCCorrectionsSerializer, CalibrationConfigurationsSerializer,
    CalibrationSettingsSerializer, CalibrationReadingsSerializer,
    CalibrationResultsSerializer, ShuntSerializer, ShuntReportSerializer,
    TVCSerializer, TVCReportSerializer, BugReportSerializer,
    WorkstationSerializer,
)

from npsl_tools.instruments import (
    Instrument11713C, Instrument3458A, Instrument5730A, Instrument5790B, 
    Instrument34420A, Instrument8508A, Instrument8100
)


def _request_client_ip(request):
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _server_ip_for_request(request):
    host = (request.get_host() or "").split(":")[0].strip("[]")
    if host and host not in ("localhost", "127.0.0.1", "0.0.0.0"):
        return host

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return host or "localhost"


INSTRUMENT_CLASS_MAP = {
    '5730A': Instrument5730A,
    '5790B': Instrument5790B,
    '3458A': Instrument3458A,
    '34420A': Instrument34420A,
    '8508A': Instrument8508A,
    '11713C': Instrument11713C,
    '8100': Instrument8100
}


IDENTITY_OPEN_TIMEOUT_MS = 5_000
IDENTITY_QUERY_TIMEOUT_MS = 5_000


def _ordered_unique_resources(resources):
    """Return every VISA resource once without hiding local instruments.

    NI-VISA may expose a mixture of local resources (for example
    ``GPIB0::4::INSTR``) and remote-server resources
    (``visa://host/GPIB0::4::INSTR``).  The previous discovery code treated
    those groups as mutually exclusive: the presence of any remote resource
    caused every local resource to be discarded.  That made instruments
    visible in NI MAX disappear from the workbench scan.

    Exact duplicate strings are removed case-insensitively.  Local and remote
    addresses are otherwise retained because the same GPIB bus/address on two
    workstations represents two different physical instruments.
    """
    seen = set()
    unique = []
    for resource in resources or ():
        address = str(resource).strip()
        if not address:
            continue
        key = address.casefold()
        if key in seen:
            continue
        seen.add(key)
        unique.append(address)

    # Keep the result deterministic while presenting local resources first.
    return sorted(
        unique,
        key=lambda address: (
            address.casefold().startswith("visa://"),
            address.casefold(),
        ),
    )


def get_instrument_identity(rm, address):
    """
    Attempts to identify an instrument by trying a series of common commands.

    Five seconds is intentionally more forgiving than the former 500 ms
    window.  Real 5730A and 8508A hardware can take longer than half a second
    to complete a remote open/query even though NI MAX has already enumerated
    the resource.
    """
    identity_commands = ['*IDN?', 'ID?']
    
    try:
        instrument = rm.open_resource(address, open_timeout=IDENTITY_OPEN_TIMEOUT_MS)
        instrument.timeout = IDENTITY_QUERY_TIMEOUT_MS

        # A VISA interface clear is useful when a prior client left unread
        # bytes, but some gateways do not implement it.  Discovery must still
        # attempt *IDN? when clear is unsupported.
        try:
            instrument.clear()
        except (pyvisa.errors.VisaIOError, AttributeError):
            pass

        for command in identity_commands:
            try:
                if command == 'ID?':
                    instrument.read_termination = "\r\n"
                else:
                    instrument.read_termination = "\n"
                instrument.write_termination = "\n"

                identity = instrument.query(command).strip()

                try:
                    float(identity)
                    continue
                except ValueError:
                    pass
                
                if identity:
                    if command == 'ID?' and '3458A' in identity:
                         return f"{identity}"
                    return identity
            except pyvisa.errors.VisaIOError:
                continue
        
        return "N/A - Instrument connected but did not identify."

    except pyvisa.errors.VisaIOError:
        return f"N/A - VISA I/O Error (Check connection or if in use)."
    except Exception as e:
        return f"N/A - General Error: {str(e)}"
    finally:
        if 'instrument' in locals() and hasattr(instrument, 'close'):
            instrument.close()


@api_view(['GET'])
def discover_instruments(request):
    """
    Scans for connected VISA resources, de-duplicates them robustly, and returns
    them with their identities and the local IP.

    When settings.MOCK_INSTRUMENTS is True the pyvisa path is skipped entirely
    and a deterministic mock inventory is returned instead, so the Instrument
    Status page can be exercised on dev machines with no lab hardware.
    """
    server_ip = _server_ip_for_request(request)
    client_ip = _request_client_ip(request)

    if getattr(settings, "MOCK_INSTRUMENTS", False):
        from .mock_instruments import MOCK_INVENTORY
        instruments = [
            {"address": item["address"], "identity": item["identity"]}
            for item in MOCK_INVENTORY
        ]
        print(f"[MOCK] Returning {len(instruments)} mock instruments.")
        return JsonResponse({
            "instruments": instruments,
            "local_ip": server_ip,
            "server_ip": server_ip,
            "client_ip": client_ip,
        })

    try:
        rm = pyvisa.ResourceManager()
        resources = rm.list_resources()
        print(f"Discovered VISA resources: {resources}")
    except Exception as e:
        print(f"Error initializing VISA resource manager: {e}")
        return JsonResponse({'error': 'Could not initialize VISA resource manager.', 'details': str(e)}, status=500)

    # Keep both local and remote VISA resources. They are not interchangeable:
    # a remote resource on one workstation and a local resource with the same
    # GPIB address may be two different instruments.
    final_addresses = _ordered_unique_resources(resources)

    print(f"De-duplicated instrument addresses: {final_addresses}")

    instrument_list = []
    for address in final_addresses:
        identity = get_instrument_identity(rm, address)
        instrument_list.append({
            'address': address,
            'identity': identity
        })

    response_data = {
        "instruments": instrument_list,
        "local_ip": server_ip,
        "server_ip": server_ip,
        "client_ip": client_ip,
    }

    print(f"Returning identified instruments: {instrument_list}")
    return JsonResponse(response_data)


class MessageViewSet(viewsets.ModelViewSet):
    queryset = Message.objects.all().order_by('-created_at')
    serializer_class = MessageSerializer

class ShuntViewSet(viewsets.ModelViewSet):
    queryset = Shunt.objects.prefetch_related('reports__corrections').all()
    serializer_class = ShuntSerializer


class TVCViewSet(viewsets.ModelViewSet):
    queryset = TVC.objects.prefetch_related('reports__corrections', 'sensitivities').all()
    serializer_class = TVCSerializer


class _ReportViewSetMixin:
    """Shared CRUD/pin behavior for the nested Shunt/TVC report endpoints.

    Reports of Calibration are nested under their device
    (``/shunts/<id>/reports/`` and ``/tvcs/<id>/reports/``). Every write
    re-derives which report is active so the latest-dated (or pinned)
    report always feeds live calibration math.
    """

    parent_model = None
    parent_lookup_kwarg = None  # e.g. 'shunt_pk'
    parent_field = None         # e.g. 'shunt'

    def _parent(self):
        return self.parent_model.objects.get(pk=self.kwargs[self.parent_lookup_kwarg])

    def get_queryset(self):
        return (
            self.queryset.model.objects
            .filter(**{self.parent_field: self.kwargs[self.parent_lookup_kwarg]})
            .prefetch_related('corrections')
        )

    def perform_create(self, serializer):
        parent = self._parent()
        report = serializer.save(**{self.parent_field: parent})
        parent.refresh_active_report()
        # refresh_active_report may have flipped is_active on this row; reload
        # so the create response reflects the post-recompute state.
        report.refresh_from_db()

    def perform_update(self, serializer):
        report = serializer.save()
        getattr(report, self.parent_field).refresh_active_report()
        report.refresh_from_db()

    def perform_destroy(self, instance):
        parent = getattr(instance, self.parent_field)
        instance.delete()
        parent.refresh_active_report()

    @action(detail=True, methods=['post'])
    def pin(self, request, **kwargs):
        """Pin/unpin this report as the active one.

        Pinning forces this report active even if a newer-dated report
        exists; unpinning reverts to automatic latest-date selection.
        """
        report = self.get_object()
        parent = getattr(report, self.parent_field)
        should_pin = bool(request.data.get('pinned', True))
        # Only one pin at a time per device.
        parent.reports.exclude(pk=report.pk).update(is_pinned=False)
        report.is_pinned = should_pin
        report.save(update_fields=['is_pinned'])
        parent.refresh_active_report()
        report.refresh_from_db()
        return Response(self.get_serializer(report).data)


class ShuntReportViewSet(_ReportViewSetMixin, viewsets.ModelViewSet):
    queryset = ShuntReport.objects.all()
    serializer_class = ShuntReportSerializer
    parent_model = Shunt
    parent_lookup_kwarg = 'shunt_pk'
    parent_field = 'shunt'


class TVCReportViewSet(_ReportViewSetMixin, viewsets.ModelViewSet):
    queryset = TVCReport.objects.all()
    serializer_class = TVCReportSerializer
    parent_model = TVC
    parent_lookup_kwarg = 'tvc_pk'
    parent_field = 'tvc'

class WorkstationViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only list/retrieve for the session-setup dropdown.

    CRUD on Workstation rows is intentionally kept in the Django admin —
    workstations are rarely-edited reference data (think: "Bench 3" gets
    renamed once, maybe; a new bench is added once a year) and gating
    edits behind admin keeps accidental misconfiguration off the hot path.
    The frontend only needs to list active benches, which this endpoint
    serves with the attached claim snapshot so the picker can render
    claim status in one round trip.
    """

    # select_related('claim') avoids N+1 in the list endpoint by pulling the
    # OneToOne reverse side in the same SELECT.
    queryset = (
        Workstation.objects
        .filter(is_active=True)
        .select_related('claim', 'claim__active_session')
        .order_by('name')
    )
    serializer_class = WorkstationSerializer


class BugReportViewSet(viewsets.ModelViewSet):
    queryset = BugReport.objects.all().order_by('-created_at')
    serializer_class = BugReportSerializer

    def get_queryset(self):
        qs = BugReport.objects.all().order_by('-created_at')
        # Cap list payload for the in-app browser (newest first).
        if getattr(self, 'action', None) == 'list':
            return qs[:200]
        return qs

    def get_permissions(self):
        # Lab clients are often unauthenticated; full in-app CRUD from the desktop UI.
        return [AllowAny()]

class CalibrationViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing Calibration records, which link together
    all aspects of a calibration for a given session.
    """
    queryset = Calibration.objects.all()
    serializer_class = CalibrationSerializer

class CalibrationSessionViewSet(viewsets.ModelViewSet):
    """
    API endpoint for managing Calibration Session records.
    """
    queryset = CalibrationSession.objects.all().order_by('-created_at')
    serializer_class = CalibrationSessionSerializer

    @action(detail=True, methods=['post'], url_path='initialize-instruments')
    def initialize_instruments(self, request, pk=None):
        session = self.get_object()
        
        assigned_instruments = [
            ("Standard Reader", session.standard_reader_model, session.standard_reader_address, session.standard_reader_input),
            ("Test Reader", session.test_reader_model, session.test_reader_address, session.test_reader_input),
            ("AC Source", "5730A", session.ac_source_address, None),
            ("DC Source", "5730A", session.dc_source_address, None),
            ("Switch Driver", session.switch_driver_model, session.switch_driver_address, None),
            ("Amplifier", "8100", session.amplifier_address, None),
        ]

        initialized = []
        errors = []

        for role, model, address, input_terminal in assigned_instruments:
            if not model or not address:
                continue

            instrument = None
            try:
                instrument_class = INSTRUMENT_CLASS_MAP.get(model)
                if not instrument_class:
                    raise RuntimeError(f"Unknown instrument model: {model}")

                print(f"Initializing {role} ({model}) at {address}...")
                # Instantiating the class runs its __init__ method, which performs the initialization
                if instrument_class in [Instrument34420A, Instrument11713C]:
                     instrument = instrument_class(gpib=address)
                elif instrument_class == Instrument8508A:
                     instrument = instrument_class(
                         gpib=address,
                         input_terminal=input_terminal or "FRONT",
                     )
                else:
                     instrument = instrument_class(model=model, gpib=address)
                
                initialized.append(f"{role} ({model})")

            except Exception as e:
                errors.append(f"{role}: {str(e)}")
            finally:
                # Ensure the VISA resource is closed after initialization
                if instrument:
                    close = getattr(instrument, "close", None)
                    if callable(close):
                        close()
                    else:
                        connection = getattr(instrument, 'resource', None) or getattr(instrument, 'device', None)
                        if connection and hasattr(connection, 'close'):
                            connection.close()
        
        if errors:
            return Response(
                {"status": "Completed with errors", "initialized": initialized, "errors": errors},
                status=status.HTTP_207_MULTI_STATUS
            )

        return Response(
            {"status": "All assigned instruments initialized successfully.", "initialized": initialized},
            status=status.HTTP_200_OK
        )

    @action(detail=True, methods=['get', 'put'], url_path='information')
    def calibration_handler(self, request, pk=None):
        session = self.get_object()
        calibration, _ = Calibration.objects.get_or_create(session=session)

        CalibrationConfigurations.objects.get_or_create(calibration=calibration)
        CalibrationTVCCorrections.objects.get_or_create(calibration=calibration)

        if request.method == 'GET':
            serializer = CalibrationSerializer(calibration)
            return Response(serializer.data)

        elif request.method == 'PUT':
            serializer = CalibrationSerializer(calibration, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get', 'put'], url_path='tvc-corrections')
    def calibration_tvc_corrections_handler(self, request, pk=None):
        session = self.get_object()
        calibration, _ = Calibration.objects.get_or_create(session=session)
        tvc_corrections, _ = CalibrationTVCCorrections.objects.get_or_create(calibration=calibration)

        if request.method == 'GET':
            serializer = CalibrationTVCCorrectionsSerializer(tvc_corrections)
            return Response(serializer.data)

        elif request.method == 'PUT':
            serializer = CalibrationTVCCorrectionsSerializer(tvc_corrections, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
    @action(detail=True, methods=['get', 'put'], url_path='configurations')
    def calibration_configurations_handler(self, request, pk=None):
        session = self.get_object()
        calibration, _ = Calibration.objects.get_or_create(session=session)
        configurations, _ = CalibrationConfigurations.objects.get_or_create(calibration=calibration)

        if request.method == 'GET':
            serializer = CalibrationConfigurationsSerializer(configurations)
            return Response(serializer.data)

        elif request.method == 'PUT':
            serializer = CalibrationConfigurationsSerializer(configurations, data=request.data, partial=True)
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


    @action(detail=True, methods=['get', 'put'], url_path='settings')
    def test_point_settings_handler(self, request, pk=None):
        session = self.get_object()
        test_point_set, _ = TestPointSet.objects.get_or_create(session=session)
        test_points = test_point_set.points.all()

        if request.method == 'GET':
            all_settings_data = []
            for tp in test_points:
                try:
                    settings_instance = tp.settings
                    settings_serializer = CalibrationSettingsSerializer(settings_instance)
                    settings_dict = settings_serializer.data
                    settings_dict['test_point_id'] = tp.id
                    all_settings_data.append(settings_dict)
                except ObjectDoesNotExist:
                    pass

            return Response(all_settings_data, status=status.HTTP_200_OK)

        elif request.method == 'PUT':
            incoming_settings_list = request.data
            
            with transaction.atomic():
                existing_test_points_map = {tp.id: tp for tp in test_point_set.points.all()}

                for settings_data in incoming_settings_list:
                    test_point_id = settings_data.pop('test_point_id', None)

                    if not test_point_id:
                        return Response(
                            {"detail": "Each setting object must include 'test_point_id'."},
                            status=status.HTTP_400_BAD_REQUEST
                        )

                    test_point_instance = existing_test_points_map.get(test_point_id)

                    if not test_point_instance:
                        return Response(
                            {"detail": f"TestPoint with ID {test_point_id} not found for this session."},
                            status=status.HTTP_404_NOT_FOUND
                        )

                    existing_settings_instance = getattr(test_point_instance, 'settings', None)

                    if existing_settings_instance:
                        settings_serializer = CalibrationSettingsSerializer(
                            instance=existing_settings_instance,
                            data=settings_data,
                            partial=True
                        )
                    else:
                        settings_serializer = CalibrationSettingsSerializer(data=settings_data)

                    settings_serializer.is_valid(raise_exception=True)
                    new_or_updated_settings = settings_serializer.save()

                    if not test_point_instance.settings or test_point_instance.settings != new_or_updated_settings:
                        test_point_instance.settings = new_or_updated_settings
                        test_point_instance.save(update_fields=['settings'])

            return self.test_point_settings_handler(request._request, pk=pk)

        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
    
    @action(detail=True, methods=['get', 'put'], url_path='readings')
    def test_point_readings_handler(self, request, pk=None):
        session = self.get_object()
        test_point_set, _ = TestPointSet.objects.get_or_create(session=session)
        test_points = test_point_set.points.all()

        if request.method == 'GET':
            all_readings_data = []
            for tp in test_points:
                try:
                    readings_instance = tp.readings
                    readings_serializer = CalibrationReadingsSerializer(readings_instance)
                    readings_dict = readings_serializer.data
                    readings_dict['test_point_id'] = tp.id
                    all_readings_data.append(readings_dict)
                except ObjectDoesNotExist:
                    pass

            return Response(all_readings_data, status=status.HTTP_200_OK)

        elif request.method == 'PUT':
            incoming_readings_list = request.data
            
            with transaction.atomic():
                existing_test_points_map = {tp.id: tp for tp in test_point_set.points.all()}

                for readings_data in incoming_readings_list:
                    test_point_id = readings_data.pop('test_point_id', None)

                    if not test_point_id:
                        return Response(
                            {"detail": "Each setting object must include 'test_point_id'."},
                            status=status.HTTP_400_BAD_REQUEST
                        )

                    test_point_instance = existing_test_points_map.get(test_point_id)

                    if not test_point_instance:
                        return Response(
                            {"detail": f"TestPoint with ID {test_point_id} not found for this session."},
                            status=status.HTTP_404_NOT_FOUND
                        )

                    existing_readings_instance = getattr(test_point_instance, 'readings', None)

                    if existing_readings_instance:
                        readings_serializer = CalibrationReadingsSerializer(
                            instance=existing_readings_instance,
                            data=readings_data,
                            partial=True
                        )
                    else:
                        readings_serializer = CalibrationReadingsSerializer(data=readings_data)

                    readings_serializer.is_valid(raise_exception=True)
                    new_or_updated_readings = readings_serializer.save()

                    if not test_point_instance.readings or test_point_instance.readings != new_or_updated_readings:
                        test_point_instance.readings = new_or_updated_readings
                        test_point_instance.save(update_fields=['readings'])

            return self.test_point_readings_handler(request._request, pk=pk)

        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
    
    @action(detail=True, methods=['get', 'put'], url_path='results')
    def test_point_results_handler(self, request, pk=None):
        session = self.get_object()
        test_point_set, _ = TestPointSet.objects.get_or_create(session=session)
        test_points = test_point_set.points.all()

        if request.method == 'GET':
            all_results_data = []
            for tp in test_points:
                try:
                    results_instance = tp.results
                    results_serializer = CalibrationResultsSerializer(results_instance)
                    results_dict = results_serializer.data
                    results_dict['test_point_id'] = tp.id
                    all_results_data.append(results_dict)
                except ObjectDoesNotExist:
                    pass

            return Response(all_results_data, status=status.HTTP_200_OK)

        elif request.method == 'PUT':
            incoming_results_list = request.data
            
            with transaction.atomic():
                existing_test_points_map = {tp.id: tp for tp in test_point_set.points.all()}

                for results_data in incoming_results_list:
                    test_point_id = results_data.pop('test_point_id', None)

                    if not test_point_id:
                        return Response(
                            {"detail": "Each setting object must include 'test_point_id'."},
                            status=status.HTTP_400_BAD_REQUEST
                        )

                    test_point_instance = existing_test_points_map.get(test_point_id)

                    if not test_point_instance:
                        return Response(
                            {"detail": f"TestPoint with ID {test_point_id} not found for this session."},
                            status=status.HTTP_404_NOT_FOUND
                        )

                    existing_results_instance = getattr(test_point_instance, 'readings', None)

                    if existing_results_instance:
                        results_serializer = CalibrationResultsSerializer(
                            instance=existing_results_instance,
                            data=results_data,
                            partial=True
                        )
                    else:
                        results_serializer = CalibrationResultsSerializer(data=results_data)

                    results_serializer.is_valid(raise_exception=True)
                    new_or_updated_results = results_serializer.save()

                    if not test_point_instance.results or test_point_instance.results != new_or_updated_results:
                        test_point_instance.results = new_or_updated_results
                        test_point_instance.save(update_fields=['results'])

            return self.test_point_results_handler(request._request, pk=pk)

        return Response(status=status.HTTP_405_METHOD_NOT_ALLOWED)
    
    @action(detail=True, methods=['get'], url_path='settings/(?P<tp_id>[^/.]+)?')
    def session_settings_handler(self, request, pk=None, tp_id=None):
        session = self.get_object()

        try:
            test_point_set = TestPointSet.objects.get(session=session)
        except TestPointSet.DoesNotExist:
            return Response(
                {"detail": "Test point set not found for this session."},
                status=status.HTTP_404_NOT_FOUND
            )

        if tp_id:
            try:
                test_point = test_point_set.points.get(pk=tp_id)
                settings_instance = getattr(test_point, 'settings', None)
                if settings_instance:
                    serializer = CalibrationSettingsSerializer(settings_instance)
                    return Response(serializer.data, status=status.HTTP_200_OK)
                else:
                    return Response(
                        {"detail": f"No settings found for test point {tp_id}."},
                        status=status.HTTP_404_NOT_FOUND
                    )
            except TestPoint.DoesNotExist:
                return Response(
                    {"detail": f"Test point {tp_id} not found in this session."},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            all_settings = []
            test_points = test_point_set.points.all()

            for tp in test_points:
                settings_instance = getattr(tp, 'settings', None)
                if settings_instance:
                    all_settings.append(settings_instance)

            serializer = CalibrationSettingsSerializer(all_settings, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
    @action(detail=True, methods=['get'], url_path='readings/(?P<tp_id>[^/.]+)?')
    def session_readings_handler(self, request, pk=None, tp_id=None):
        session = self.get_object()

        try:
            test_point_set = TestPointSet.objects.get(session=session)
        except TestPointSet.DoesNotExist:
            return Response(
                {"detail": "Test point set not found for this session."},
                status=status.HTTP_404_NOT_FOUND
            )

        if tp_id:
            try:
                test_point = test_point_set.points.get(pk=tp_id)
                readings_instance = getattr(test_point, 'readings', None)
                if readings_instance:
                    serializer = CalibrationReadingsSerializer(readings_instance)
                    return Response(serializer.data, status=status.HTTP_200_OK)
                else:
                    return Response(
                        {"detail": f"No readings found for test point {tp_id}."},
                        status=status.HTTP_404_NOT_FOUND
                    )
            except TestPoint.DoesNotExist:
                return Response(
                    {"detail": f"Test point {tp_id} not found in this session."},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            all_readings = []
            test_points = test_point_set.points.all()

            for tp in test_points:
                readings_instance = getattr(tp, 'readings', None)
                if readings_instance:
                    all_readings.append(readings_instance)

            serializer = CalibrationReadingsSerializer(all_readings, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
    @action(detail=True, methods=['get'], url_path='results/(?P<tp_id>[^/.]+)?')
    def session_results_handler(self, request, pk=None, tp_id=None):
        session = self.get_object()

        try:
            test_point_set = TestPointSet.objects.get(session=session)
        except TestPointSet.DoesNotExist:
            return Response(
                {"detail": "Test point set not found for this session."},
                status=status.HTTP_404_NOT_FOUND
            )

        if tp_id:
            try:
                test_point = test_point_set.points.get(pk=tp_id)
                results_instance = getattr(test_point, 'results', None)
                if results_instance:
                    serializer = CalibrationResultsSerializer(results_instance)
                    return Response(serializer.data, status=status.HTTP_200_OK)
                else:
                    return Response(
                        {"detail": f"No results found for test point {tp_id}."},
                        status=status.HTTP_404_NOT_FOUND
                    )
            except TestPoint.DoesNotExist:
                return Response(
                    {"detail": f"Test point {tp_id} not found in this session."},
                    status=status.HTTP_404_NOT_FOUND
                )
        else:
            all_results = []
            test_points = test_point_set.points.all()

            for tp in test_points:
                results_instance = getattr(tp, 'results', None)
                if results_instance:
                    all_results.append(results_instance)

            serializer = CalibrationResultsSerializer(all_results, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        
def _next_test_point_order(test_point_set):
    """Return the next sort-order value for a new point in this set.

    TestPoint.Meta.ordering uses ``order`` as the primary sort key with
    ``frequency`` as the tiebreaker. The model default for ``order`` is 0,
    so naively creating a new point after the user has dragged the list
    (which writes a contiguous 0..N range via :func:`update_order`) makes
    the new point sort *above* everything — and naively creating it on a
    fresh session leaves every row at 0, where the frequency fallback
    naturally takes over. To get sensible behavior in both cases, pin new
    points to one slot past the current max ``order`` so they land at the
    end of whatever the user is currently looking at.
    """
    current_max = (
        test_point_set.points.order_by('-order').values_list('order', flat=True).first()
    )
    return (current_max or 0) + 1


def _broadcast_test_point_sync(session_pk, message):
    """Push a ``connection_sync`` event to every socket in the session group.

    Remote viewers key off this to re-fetch the session's test-point data so
    their sidebar status dots, completion badges, and charts stay in sync
    with host-side edits that bypass the calibration WebSocket pipeline
    (e.g. clear readings, delete point, append points from the REST API).
    Host sockets simply no-op on the refresh since they already know the
    change they just made.
    """
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            f'session_{session_pk}',
            {
                'type': 'connection_sync',
                'is_complete': False,
                'message': message,
            },
        )
    except Exception as e:
        # Broadcast is best-effort — surface the error in logs but don't fail
        # the HTTP request the host is waiting on.
        print(f"[sync] Failed to broadcast test-point change: {e}", flush=True)


class TestPointViewSet(viewsets.ModelViewSet):
    serializer_class = TestPointSerializer

    def get_queryset(self):
        # Eager-load the nested 1:1 / FK chain the serializer touches so
        # rendering a session's test points is a small fixed number of
        # queries instead of O(N) per-point lazy lookups. The serializer
        # reads ``tp.settings``, ``tp.readings``, ``tp.results`` (each
        # reverse OneToOne), ``tp.results.cycles`` (reverse FK, many),
        # and walks the ``test_point_set → session → calibration →
        # configurations`` chain inside ``build_pair_analytics``.
        return (
            TestPoint.objects
            .filter(test_point_set__session_id=self.kwargs['session_pk'])
            .select_related(
                'settings',
                'readings',
                'results',
                'test_point_set__session__calibration__configurations',
            )
            .prefetch_related('results__cycles')
        )

    def list(self, request, *args, **kwargs):
        # Resolve the queryset once and build a sibling lookup keyed by
        # (test_point_set_id, current, frequency, direction). All
        # siblings of any point in this response are already loaded — the
        # serializer's pair_analytics call can pull its opposite-direction
        # counterpart from this map instead of issuing one DB query per
        # point. Falls back to the model's original ``.get`` if the map
        # isn't populated (detail/retrieve calls).
        queryset = self.filter_queryset(self.get_queryset())
        test_points = list(queryset)
        self._sibling_map = {
            (tp.test_point_set_id, tp.current, tp.frequency, tp.direction): tp
            for tp in test_points
        }
        serializer = self.get_serializer(test_points, many=True)
        return Response(serializer.data)

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        sibling_map = getattr(self, '_sibling_map', None)
        if sibling_map is not None:
            ctx['sibling_map'] = sibling_map
        return ctx

    def perform_create(self, serializer):
        session = CalibrationSession.objects.get(pk=self.kwargs['session_pk'])
        test_point_set = TestPointSet.objects.get(session=session)
        serializer.save(
            test_point_set=test_point_set,
            order=_next_test_point_order(test_point_set),
        )
        _broadcast_test_point_sync(self.kwargs['session_pk'], 'Test point added.')

    def perform_destroy(self, instance):
        session_pk = self.kwargs['session_pk']
        instance.delete()
        _broadcast_test_point_sync(session_pk, 'Test point deleted.')
    
    @action(detail=True, methods=['post'], url_path='mark-readings-stability')
    def mark_readings_stability(self, request, session_pk=None, pk=None):
        """
        Marks a range of readings for a specific measurement type as stable or unstable.
        """
        try:
            reading_key = request.data.get('reading_key')
            start_index = request.data.get('start_index')
            end_index = request.data.get('end_index')
            is_stable = request.data.get('is_stable')

            if not all([reading_key, start_index, end_index, is_stable is not None]):
                return Response(
                    {"detail": "Missing required fields: reading_key, start_index, end_index, is_stable."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            test_point = self.get_queryset().get(pk=pk)
            readings = getattr(test_point, 'readings', None)
            
            if not readings:
                return Response(
                    {"detail": "No readings object found for this test point."},
                    status=status.HTTP_404_NOT_FOUND
                )

            reading_list = getattr(readings, reading_key, None)

            if not isinstance(reading_list, list):
                return Response(
                    {"detail": f"Reading key '{reading_key}' not found or is not a list."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Convert 1-based user index to 0-based python index
            start = int(start_index) - 1
            end = int(end_index) # Slice end is exclusive, so user's 'end' is correct
            
            if start < 0 or end > len(reading_list) or start >= end:
                return Response(
                    {"detail": "Invalid start/end index range."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            modified_count = 0
            with transaction.atomic():
                for i in range(start, end):
                    if isinstance(reading_list[i], dict):
                        reading_list[i]['is_stable'] = bool(is_stable)
                        modified_count += 1
                    # Handle legacy data that might just be values (optional, but good practice)
                    elif isinstance(reading_list[i], (int, float)):
                        # This data point has no timestamp or stable flag, so we can't update it.
                        # Or, we could convert it, but that might be out of scope.
                        # For now, we just skip it.
                        pass
                
                setattr(readings, reading_key, reading_list)
                readings.save(update_fields=[reading_key])
                
                # CRITICAL: Recalculate averages after changing stability
                readings.update_related_results()

            return Response(
                {"message": f"Successfully updated {modified_count} readings as {'stable' if is_stable else 'unstable'} and recalculated averages."},
                status=status.HTTP_200_OK
            )

        except TestPoint.DoesNotExist:
            return Response({"detail": "Test point not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"detail": f"An unexpected error occurred: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], url_path='actions/apply-settings-to-all')
    def apply_settings_to_all(self, request, session_pk=None):
        full_settings_data = request.data.get('settings')
        focused_tp_id = request.data.get('focused_test_point_id')

        if not full_settings_data or not focused_tp_id:
            return Response({"detail": "Both 'settings' and 'focused_test_point_id' are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            test_point_set = TestPointSet.objects.get(session_id=session_pk)
            
            # Identify the focused point to determine its current/frequency pair AND direction
            focused_point = test_point_set.points.get(pk=focused_tp_id)
            focused_key = (focused_point.current, focused_point.frequency)
            
            # Capture the active direction
            active_direction = focused_point.direction

            # Settings payload for the specific focused point (contains the user-defined warm-up time)
            full_warmup_settings = full_settings_data.copy()

            # Common settings payload for all other points in THIS direction
            common_settings_data = full_settings_data.copy()
            
            # ONLY remove the initial warm up time so it isn't copied to subsequent points
            common_settings_data.pop('initial_warm_up_time', None)

            # Get all unique (current, frequency) pairs for the session
            unique_points = test_point_set.points.values('current', 'frequency').distinct()

            valid_fields = [f.name for f in CalibrationSettings._meta.get_fields()]

            # n_cycles is a single source of truth shared across BOTH
            # directions of a pair, so mirror just that field onto the
            # opposite direction too. Without this, applying settings to the
            # active direction would leave the opposite direction on its old
            # (often default) cycle count, which makes already-complete points
            # look like they have missing cycles.
            opposite_direction = 'Reverse' if active_direction == 'Forward' else 'Forward'
            shared_n_cycles = full_settings_data.get('n_cycles')

            with transaction.atomic():
                for point_key in unique_points:
                    current = point_key['current']
                    frequency = point_key['frequency']

                    is_focused_pair = (current, frequency) == focused_key

                    # Select the correct payload for this point
                    target_settings = full_warmup_settings if is_focused_pair else common_settings_data
                    target_settings = {k: v for k, v in target_settings.items() if k in valid_fields}

                    # We ONLY update points matching the active direction
                    point_obj, _ = TestPoint.objects.get_or_create(
                        test_point_set=test_point_set,
                        current=current,
                        frequency=frequency,
                        direction=active_direction
                    )

                    CalibrationSettings.objects.update_or_create(
                        test_point=point_obj,
                        defaults=target_settings
                    )

                    # Keep the opposite direction's cycle count in sync.
                    if shared_n_cycles is not None and 'n_cycles' in valid_fields:
                        opposite_obj, _ = TestPoint.objects.get_or_create(
                            test_point_set=test_point_set,
                            current=current,
                            frequency=frequency,
                            direction=opposite_direction
                        )
                        CalibrationSettings.objects.update_or_create(
                            test_point=opposite_obj,
                            defaults={'n_cycles': shared_n_cycles}
                        )

            return Response({"message": f"Settings successfully applied to all {active_direction} test points."}, status=status.HTTP_200_OK)

        except TestPointSet.DoesNotExist:
            return Response({"detail": "TestPointSet not found for this session."}, status=status.HTTP_404_NOT_FOUND)
        except TestPoint.DoesNotExist:
            return Response({"detail": "Focused test point not found in this session."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({"detail": f"An unexpected error occurred: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=False, methods=['post'], url_path='actions/update-order')
    def update_order(self, request, session_pk=None):
        """
        Receives an ordered list of test point keys and updates the 'order'
        field for both Forward and Reverse directions of each point.
        """
        ordered_keys = request.data.get('ordered_keys', [])

        if not ordered_keys:
            return Response({"detail": "An ordered list of keys is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            test_point_set = TestPointSet.objects.get(session_id=session_pk)
            with transaction.atomic():
                for index, key in enumerate(ordered_keys):
                    current_str, frequency_str = key.split('-')
                    # Update both Forward and Reverse points for the given key
                    test_point_set.points.filter(
                        current=current_str,
                        frequency=frequency_str
                    ).update(order=index)

            return Response({"message": "Test point order updated successfully."}, status=status.HTTP_200_OK)

        except TestPointSet.DoesNotExist:
            return Response({"detail": "TestPointSet not found for this session."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"detail": f"An error occurred: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=False, methods=['post'], url_path='append')
    def append_points(self, request, session_pk=None):
        """
        Creates new test points for the session and broadcasts a sync message to update the UI.
        """
        points_data = request.data.get('points', [])
        try:
            tp_set, created_tp_set = TestPointSet.objects.get_or_create(session_id=session_pk)
            existing = tp_set.points.values_list('current', 'frequency', 'direction')
            existing_set = { (str(c), f, d) for c, f, d in existing }

            # Sort-order bookkeeping: each (current, frequency) pair must
            # share an ``order`` value across its Forward + Reverse rows so
            # Meta.ordering keeps them adjacent. We allocate one slot past
            # the current max for each *new* pair we encounter and reuse it
            # for the matching opposite-direction row in the same payload.
            next_order = _next_test_point_order(tp_set)
            pair_orders = {}

            points_to_create = []
            for point in points_data:
                key = (
                    str(point.get('current')),
                    point.get('frequency'),
                    point.get('direction')
                )

                if key not in existing_set:
                    pair_key = (key[0], key[1])
                    if pair_key not in pair_orders:
                        pair_orders[pair_key] = next_order
                        next_order += 1
                    points_to_create.append(
                        TestPoint(
                            test_point_set=tp_set,
                            order=pair_orders[pair_key],
                            **point,
                        )
                    )
                    existing_set.add(key)

            if points_to_create:
                TestPoint.objects.bulk_create(points_to_create)

                # --- BROADCAST SYNC TO FRONTEND ---
                # This ensures the Sidebar and Main views refresh automatically via WebSockets
                channel_layer = get_channel_layer()
                async_to_sync(channel_layer.group_send)(
                    f'session_{session_pk}',
                    {
                        'type': 'connection_sync',
                        'is_complete': False,
                        'message': 'Test points appended.'
                    }
                )

            # Each user-facing "test point" is a (current, frequency) pair
            # that's stored as two rows (Forward + Reverse). Report the
            # logical count so the toast matches what the operator added.
            logical_added = len({
                (tp.current, tp.frequency) for tp in points_to_create
            })
            return Response(
                {"message": f"Added {logical_added} new test point(s)."},
                status=status.HTTP_201_CREATED
            )

        except CalibrationSession.DoesNotExist:
            return Response({"detail": "Calibration Session not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e: 
            return Response({"detail": f"An error occurred: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)
        
    @action(detail=False, methods=['delete'], url_path='clear')
    def clear_test_points(self, request, session_pk=None):
        try:
            tp_set = TestPointSet.objects.get(session__id=session_pk)
        except TestPointSet.DoesNotExist:
            return Response(
                {"detail": "TestPointSet not found for this session, nothing to clear."},
                status=status.HTTP_404_NOT_FOUND
            )
        except CalibrationSession.DoesNotExist:
            return Response({"detail": "Calibration Session not found."}, status=status.HTTP_404_NOT_FOUND)

        deleted_count, _ = tp_set.points.all().delete()
        _broadcast_test_point_sync(session_pk, 'All test points cleared.')
        return Response(
            {"message": f"Deleted {deleted_count} test points for session {session_pk}."},
            status=status.HTTP_204_NO_CONTENT
        )

    @action(detail=True, methods=['post'], url_path='clear-readings')
    def clear_readings(self, request, session_pk=None, pk=None):
        """
        Clears all readings and calculated results for a specific test point.
        """
        try:
            test_point = self.get_queryset().get(pk=pk)
            
            with transaction.atomic():
                # 1. Reset the failure flag so the UI clears the red border
                test_point.is_stability_failed = False
                test_point.save(update_fields=['is_stability_failed'])

                # 2. Safely delete results if they exist (avoids RelatedObjectDoesNotExist exception)
                CalibrationResults.objects.filter(test_point=test_point).delete()

                # 3. Clear all readings arrays
                readings_instance = getattr(test_point, 'readings', None)
                if readings_instance:
                    readings_instance.std_ac_open_readings = []
                    readings_instance.std_dc_pos_readings = []
                    readings_instance.std_dc_neg_readings = []
                    readings_instance.std_ac_close_readings = []
                    readings_instance.ti_ac_open_readings = []
                    readings_instance.ti_dc_pos_readings = []
                    readings_instance.ti_dc_neg_readings = []
                    readings_instance.ti_ac_close_readings = []
                    readings_instance.save()

            _broadcast_test_point_sync(session_pk, 'Readings cleared.')

            return Response(
                {"message": f"Readings and results for Test Point {pk} have been cleared."},
                status=status.HTTP_200_OK
            )

        except TestPoint.DoesNotExist:
            return Response({"detail": "Test point not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"detail": f"An unexpected error occurred: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['post'], url_path='calculate-averages')
    def calculate_averages(self, request, session_pk=None, pk=None):
        """
        Manually triggers the calculation of averages for a specific test point's readings.
        This should be called after all raw readings for the point have been collected.
        """
        print(f"[DEBUG - Views] Endpoint '/calculate-averages/' hit for TestPoint ID: {pk}")
        try:
            test_point = self.get_queryset().get(pk=pk)
            readings = getattr(test_point, 'readings', None)

            if not readings:
                return Response(
                    {"detail": "No readings found for this test point to calculate."}, 
                    status=status.HTTP_404_NOT_FOUND
                )

            # Manually trigger the calculation method from the model
            readings.update_related_results()

            # Return the newly calculated and saved results
            results_serializer = CalibrationResultsSerializer(test_point.results)
            return Response(results_serializer.data, status=status.HTTP_200_OK)

        except TestPoint.DoesNotExist:
            return Response({"detail": "Test point not found."}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({"detail": f"An error occurred during calculation: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=['patch'], url_path='analytics')
    def analytics(self, request, session_pk=None, pk=None):
        """Persist the user-controlled analytics state for the (Fwd, Rev)
        pair this test point belongs to and recompute the pair aggregate.

        Accepts any subset of:
          - manual_excluded_pairs: list[int]
          - use_abba_pairing: bool | null (null = inherit session config)
          - outlier_filter_mode: 'none' | 'auto'

        Writes to whichever direction row the caller addressed; the
        recompute step then mirrors the resolved state onto both rows.
        Returns the updated CalibrationResults payload (which includes
        the canonical pair_analytics blob).
        """
        try:
            test_point = self.get_queryset().get(pk=pk)
        except TestPoint.DoesNotExist:
            return Response({"detail": "Test point not found."}, status=status.HTTP_404_NOT_FOUND)

        results, _ = CalibrationResults.objects.get_or_create(test_point=test_point)

        fields_to_save = []
        if 'manual_excluded_pairs' in request.data:
            raw = request.data.get('manual_excluded_pairs') or []
            try:
                cleaned = sorted({int(x) for x in raw})
            except (TypeError, ValueError):
                return Response(
                    {"detail": "manual_excluded_pairs must be a list of integers."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            results.manual_excluded_pairs = cleaned
            fields_to_save.append('manual_excluded_pairs')

        if 'use_abba_pairing' in request.data:
            val = request.data.get('use_abba_pairing')
            results.use_abba_pairing = None if val is None else bool(val)
            fields_to_save.append('use_abba_pairing')

        if 'outlier_filter_mode' in request.data:
            mode = request.data.get('outlier_filter_mode') or 'none'
            if mode not in ('none', 'auto'):
                return Response(
                    {"detail": "outlier_filter_mode must be 'none' or 'auto'."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            results.outlier_filter_mode = mode
            fields_to_save.append('outlier_filter_mode')

        if fields_to_save:
            results.save(update_fields=fields_to_save)

        # Mirror the user-supplied analytics state onto the sibling row
        # *before* recompute. Otherwise `recompute_pair_aggregate`'s
        # cross-row union of exclusions can resurrect a value the user
        # just removed (since the sibling still holds the previously-
        # mirrored copy).
        try:
            opposite = 'Reverse' if test_point.direction == 'Forward' else 'Forward'
            sibling_tp = TestPoint.objects.get(
                test_point_set=test_point.test_point_set,
                current=test_point.current,
                frequency=test_point.frequency,
                direction=opposite,
            )
            sibling_results = getattr(sibling_tp, 'results', None)
            if sibling_results is not None and fields_to_save:
                for f in fields_to_save:
                    setattr(sibling_results, f, getattr(results, f))
                sibling_results.save(update_fields=fields_to_save)
        except TestPoint.DoesNotExist:
            pass

        results.recompute_pair_aggregate()

        # Refresh and serialize. Return the focused side's payload; the
        # sibling can be re-fetched by the frontend if it needs both.
        results.refresh_from_db()
        return Response(CalibrationResultsSerializer(results).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['put'], url_path='update-results')
    def update_results(self, request, session_pk=None, pk=None):
        """Update correction factors for a test point.

        Correction factors (eta_std, eta_ti, delta_std, delta_ti,
        delta_std_known) are physical properties of the standards/UUT,
        so they apply to BOTH directions of the (current, frequency)
        pair and to every cycle within each direction.

        Flow:
          1. Save the new corrections on the targeted row.
          2. Mirror the same correction fields onto the opposite-
             direction sibling row.
          3. On each direction independently: recompute the row-level
             aggregate delta_uut_ppm AND re-derive every cycle's
             delta_uut_ppm with the new corrections, then refresh the
             per-direction cycle aggregates.
          4. Recompute the shared pair aggregate (mirrored across both
             rows) so the headline reflects the new corrections.
        """
        try:
            test_point = self.get_queryset().get(pk=pk)
            results = getattr(test_point, 'results', None)

            if not results:
                results, _ = CalibrationResults.objects.get_or_create(test_point=test_point)

            serializer = CalibrationResultsSerializer(results, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            saved_results = serializer.save()

            # Mirror the correction fields onto the sibling row before
            # cascading the recompute, so both Fwd and Rev re-derive
            # their per-cycle deltas with the same corrections.
            CORRECTION_FIELDS = (
                'eta_std', 'eta_ti', 'delta_std', 'delta_ti', 'delta_std_known',
            )
            mirrored_keys = [k for k in CORRECTION_FIELDS if k in request.data]
            opposite = 'Reverse' if test_point.direction == 'Forward' else 'Forward'
            sibling_results = None
            if mirrored_keys:
                try:
                    sibling_tp = TestPoint.objects.get(
                        test_point_set=test_point.test_point_set,
                        current=test_point.current,
                        frequency=test_point.frequency,
                        direction=opposite,
                    )
                    sibling_results, _ = CalibrationResults.objects.get_or_create(test_point=sibling_tp)
                    for f in mirrored_keys:
                        setattr(sibling_results, f, getattr(saved_results, f))
                    sibling_results.save(update_fields=mirrored_keys)
                except TestPoint.DoesNotExist:
                    sibling_results = None

            # Cascade: row aggregate + every per-cycle delta on each side.
            saved_results.calculate_ac_dc_difference()
            saved_results.recompute_cycle_deltas()
            saved_results.recompute_cycle_aggregates()
            if sibling_results is not None:
                sibling_results.calculate_ac_dc_difference()
                sibling_results.recompute_cycle_deltas()
                sibling_results.recompute_cycle_aggregates()

            # Pair aggregate (mirrored across both rows) — single call
            # suffices because the helper writes to both Fwd and Rev.
            saved_results.recompute_pair_aggregate()

            saved_results.refresh_from_db()
            return Response(CalibrationResultsSerializer(saved_results).data, status=status.HTTP_200_OK)

        except TestPoint.DoesNotExist:
            return Response({"detail": "Test point not found."}, status=status.HTTP_404_NOT_FOUND)
                        
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)

        return Response({
            "calibration_session_id": int(self.kwargs['session_pk']),
            "test_points": serializer.data
        })

@api_view(['GET'])
def system_info(request):
    """
    Returns basic system information, such as the active database engine and
    the current state of the local write outbox (buffered stage-save rows and
    whether the default DB is reachable right now).
    """
    db_engine = settings.DATABASES['default']['ENGINE'].split('.')[-1]
    db_name = str(settings.DATABASES['default']['NAME'])

    # Outbox snapshot — imported lazily so a broken outbox can't take down
    # this lightweight endpoint.
    pending_count = 0
    failed_count = 0
    reachable = True
    try:
        from .outbox import (
            get_pending_count_sync,
            get_failed_count_sync,
            probe_default_reachable,
        )
        pending_count = get_pending_count_sync()
        failed_count = get_failed_count_sync()
        reachable = probe_default_reachable()
    except Exception as e:
        print(f"system_info: outbox snapshot failed: {e}")

    return JsonResponse({
        "database_type": db_engine,
        "database_name": db_name,
        "outbox": {
            "pending_count": pending_count,
            "failed_count": failed_count,
            "reachable": reachable,
        },
    })
