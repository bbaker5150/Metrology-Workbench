import re
from rest_framework import serializers
from .models import (
    Message, Shunt, ShuntReport, ShuntCorrection, TVC, TVCReport, TVCCorrection,
    TVCSensitivity, CalibrationSession, TestPoint, TestPointSet, Calibration,
    CalibrationTVCCorrections, CalibrationConfigurations, CalibrationSettings,
    CalibrationReadings, CalibrationResults, CalibrationResultsCycle, BugReport,
    Workstation, WorkstationClaim,
)  # noqa: F401
from datetime import datetime


class MessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Message
        fields = ['id', 'text', 'created_at']

# ==============================================================================
#  Serializers for Correction Data (Updated for Manual Entry)
# ==============================================================================

class ShuntCorrectionSerializer(serializers.ModelSerializer):
    """ Serializes a single correction point for a Shunt report. """
    id = serializers.IntegerField(required=False, allow_null=True) # Required to preserve IDs during PUT

    class Meta:
        model = ShuntCorrection
        fields = ['id', 'current', 'frequency', 'correction', 'uncertainty']


class ShuntReportSerializer(serializers.ModelSerializer):
    """ Serializes a dated Report of Calibration and its nested points. """
    id = serializers.IntegerField(required=False, allow_null=True)
    corrections = ShuntCorrectionSerializer(many=True, required=False)

    class Meta:
        model = ShuntReport
        fields = [
            'id', 'calibration_date', 'report_number', 'received_date',
            'notes', 'is_active', 'is_pinned', 'created_at', 'corrections',
        ]
        read_only_fields = ['is_active', 'created_at']

    def create(self, validated_data):
        corrections_data = validated_data.pop('corrections', [])
        report = ShuntReport.objects.create(**validated_data)
        for c in corrections_data:
            c.pop('id', None)
            ShuntCorrection.objects.create(report=report, **c)
        return report

    def update(self, instance, validated_data):
        corrections_data = validated_data.pop('corrections', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if corrections_data is not None:
            # Keep/replace points keyed by (current, frequency); drop the rest.
            keep_keys = {
                (c.get('current'), c.get('frequency'))
                for c in corrections_data
                if c.get('current') is not None and c.get('frequency') is not None
            }
            for existing in instance.corrections.all():
                if (existing.current, existing.frequency) not in keep_keys:
                    existing.delete()
            for c in corrections_data:
                cur, freq = c.get('current'), c.get('frequency')
                if cur is not None and freq is not None:
                    ShuntCorrection.objects.update_or_create(
                        report=instance,
                        current=cur,
                        frequency=freq,
                        defaults={
                            'correction': c.get('correction'),
                            'uncertainty': c.get('uncertainty'),
                        },
                    )
        return instance


class ShuntSerializer(serializers.ModelSerializer):
    """ Serializes a Shunt device and nests its dated reports. """
    reports = ShuntReportSerializer(many=True, required=False)
    size = serializers.SerializerMethodField()

    class Meta:
        model = Shunt
        fields = [
            'id', 'model_name', 'serial_number', 'range',
            'remark', 'is_manual', 'size', 'reports'
        ]
        # Suppress DRF's auto UniqueTogetherValidator so our custom validate()
        # below can return a user-facing message instead of the default
        # "must make a unique set." wording.
        validators = []

    def get_size(self, obj):
        if obj.remark:
            match = re.search(r'-(\S+?)\s+sn', obj.remark)
            if match:
                return match.group(1)
        return None

    def validate(self, attrs):
        # The DB constraint is (serial, range, is_manual), so a manual entry
        # can coexist with an imported one — but two manual rows for the same
        # pair still collide. Catch that here so the user sees a 400 with a
        # useful message instead of a 500 IntegrityError.
        if self.instance is None:  # create only
            serial = attrs.get('serial_number')
            shunt_range = attrs.get('range')
            is_manual = attrs.get('is_manual', False)
            if serial is not None and shunt_range is not None:
                existing = Shunt.objects.filter(
                    serial_number=serial,
                    range=shunt_range,
                    is_manual=is_manual,
                ).first()
                if existing is not None:
                    kind = "manual" if is_manual else "imported"
                    raise serializers.ValidationError({
                        'serial_number': (
                            f"A {kind} entry for serial {serial} at "
                            f"{shunt_range}A already exists. "
                            f"Edit it (or add a new Report of Calibration) "
                            f"instead of adding a duplicate."
                        )
                    })
        return attrs

    def create(self, validated_data):
        reports_data = validated_data.pop('reports', [])
        shunt = Shunt.objects.create(**validated_data)
        report_serializer = ShuntReportSerializer()
        for report_data in reports_data:
            report_data.pop('id', None)
            report_data['shunt'] = shunt
            report_serializer.create(report_data)
        shunt.refresh_active_report()
        return shunt

    def update(self, instance, validated_data):
        """ Update device-level fields only. Reports are managed through the
        nested /shunts/<id>/reports/ endpoints so history stays explicit. """
        validated_data.pop('reports', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class TVCCorrectionSerializer(serializers.ModelSerializer):
    """ Serializes a single correction point for a TVC report. """
    id = serializers.IntegerField(required=False, allow_null=True) # Required to preserve IDs during PUT

    class Meta:
        model = TVCCorrection
        fields = ['id', 'frequency', 'ac_dc_difference', 'expanded_uncertainty']


class TVCReportSerializer(serializers.ModelSerializer):
    """ Serializes a dated TVC Report of Calibration and its nested points. """
    id = serializers.IntegerField(required=False, allow_null=True)
    corrections = TVCCorrectionSerializer(many=True, required=False)

    class Meta:
        model = TVCReport
        fields = [
            'id', 'calibration_date', 'report_number', 'received_date',
            'notes', 'is_active', 'is_pinned', 'created_at', 'corrections',
        ]
        read_only_fields = ['is_active', 'created_at']

    def create(self, validated_data):
        corrections_data = validated_data.pop('corrections', [])
        report = TVCReport.objects.create(**validated_data)
        for c in corrections_data:
            c.pop('id', None)
            TVCCorrection.objects.create(report=report, **c)
        return report

    def update(self, instance, validated_data):
        corrections_data = validated_data.pop('corrections', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if corrections_data is not None:
            keep_freqs = {
                c.get('frequency') for c in corrections_data if c.get('frequency') is not None
            }
            instance.corrections.exclude(frequency__in=keep_freqs).delete()
            for c in corrections_data:
                freq = c.get('frequency')
                if freq is not None:
                    TVCCorrection.objects.update_or_create(
                        report=instance,
                        frequency=freq,
                        defaults={
                            'ac_dc_difference': c.get('ac_dc_difference'),
                            'expanded_uncertainty': c.get('expanded_uncertainty'),
                        },
                    )
        return instance


class TVCSensitivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = TVCSensitivity
        fields = ['id', 'current', 'frequency', 'gain_eta', 'updated_at']

class TVCSerializer(serializers.ModelSerializer):
    """ Serializes a TVC device and nests its dated reports. """
    reports = TVCReportSerializer(many=True, required=False)
    sensitivities = TVCSensitivitySerializer(many=True, read_only=True)

    class Meta:
        model = TVC
        fields = ['id', 'serial_number', 'test_voltage', 'is_manual', 'reports', 'sensitivities']

    def create(self, validated_data):
        reports_data = validated_data.pop('reports', [])
        tvc = TVC.objects.create(**validated_data)
        report_serializer = TVCReportSerializer()
        for report_data in reports_data:
            report_data.pop('id', None)
            report_data['tvc'] = tvc
            report_serializer.create(report_data)
        tvc.refresh_active_report()
        return tvc

    def update(self, instance, validated_data):
        """ Update device-level fields only. Reports are managed through the
        nested /tvcs/<id>/reports/ endpoints so history stays explicit. """
        validated_data.pop('reports', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


# ==============================================================================
#  Calibration & Session Serializers (Preserved)
# ==============================================================================

class WorkstationClaimSerializer(serializers.ModelSerializer):
    """Thin read-only view of a claim row for nesting inside Workstation.

    Used by the UI to render the "currently claimed by" chip without a
    second round trip. Live claim updates still flow over the
    ``workstation_claims_update`` WebSocket message — this serializer only
    surfaces the initial snapshot.
    """

    workstation_identifier = serializers.CharField(source='workstation.identifier', read_only=True)

    class Meta:
        model = WorkstationClaim
        fields = [
            'workstation_identifier', 'owner_channel', 'owner_client_id',
            'owner_label', 'active_session', 'claimed_at', 'last_heartbeat_at',
        ]
        read_only_fields = fields


class WorkstationSerializer(serializers.ModelSerializer):
    """Read-only projection of a bench for the session-setup dropdown.

    ``is_claimed`` lets the UI gray out benches already in use without
    having to cross-reference the separate claims payload. ``claim`` is
    included only when set so the payload stays compact for the common
    case of unclaimed benches.
    """

    is_claimed = serializers.SerializerMethodField()
    claim = serializers.SerializerMethodField()

    class Meta:
        model = Workstation
        fields = [
            'id', 'name', 'identifier', 'location', 'is_active', 'is_default',
            'instrument_addresses', 'notes', 'is_claimed', 'claim',
            'created_at', 'updated_at',
        ]

    def _claim_for(self, obj):
        # Use the reverse OneToOne accessor so list views backed by
        # ``.select_related('claim')`` (see WorkstationViewSet.queryset)
        # don't incur N+1 queries. The accessor raises DoesNotExist when
        # the bench isn't claimed; falling back to a direct filter keeps
        # the serializer working in call sites that skip select_related.
        try:
            return obj.claim
        except WorkstationClaim.DoesNotExist:
            return None
        except AttributeError:
            return WorkstationClaim.objects.filter(workstation=obj).first()

    def get_is_claimed(self, obj):
        return self._claim_for(obj) is not None

    def get_claim(self, obj):
        claim = self._claim_for(obj)
        if claim is None:
            return None
        return WorkstationClaimSerializer(claim).data


class CalibrationSessionSerializer(serializers.ModelSerializer):
    # Read gives the full workstation projection, write accepts just the id so
    # the frontend can PATCH `{"workstation_id": 3}` without round-tripping the
    # whole nested object. Nullable on both sides keeps legacy sessions editable.
    workstation = WorkstationSerializer(read_only=True)
    workstation_id = serializers.PrimaryKeyRelatedField(
        queryset=Workstation.objects.all(),
        source='workstation',
        write_only=True,
        required=False,
        allow_null=True,
    )

    class Meta:
        model = CalibrationSession
        fields = [
            'id', 'session_name', 'test_instrument_model', 'test_instrument_serial',
            'test_reader_model', 'test_reader_serial', 'test_reader_address', 'standard_instrument_model',
            'test_reader_input', 'standard_instrument_serial', 'standard_reader_model', 'standard_reader_serial',
            'standard_reader_address', 'standard_reader_input',
            'ac_source_address', 'dc_source_address', 'ac_source_serial', 'dc_source_serial', 'switch_driver_address',
            'switch_driver_model', 'switch_driver_serial',
            'reader_switch_driver_address', 'reader_switch_driver_model', 'reader_switch_driver_serial',
            'reader_switch_standard_route', 'reader_switch_settling_time',
            'amplifier_address', 'amplifier_serial', 'temperature', 'humidity',
            'created_at', 'notes', 'standard_tvc_serial', 'test_tvc_serial',
            'workstation', 'workstation_id',
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        instance = self.instance

        def value(name):
            if name in attrs:
                return attrs[name]
            return getattr(instance, name, None) if instance is not None else None

        std_model = value("standard_reader_model")
        ti_model = value("test_reader_model")
        std_address = value("standard_reader_address")
        ti_address = value("test_reader_address")
        def is_5790(model):
            return str(model or "").upper() in {"5790A", "5790B"}

        std_default = "INPUT2" if is_5790(std_model) else "FRONT"
        ti_default = "INPUT2" if is_5790(ti_model) else "REAR"
        std_input = (value("standard_reader_input") or std_default).upper()
        ti_input = (value("test_reader_input") or ti_default).upper()

        reader_route = (value("reader_switch_standard_route") or "OPEN").upper()
        if reader_route not in {"OPEN", "CLOSED"}:
            raise serializers.ValidationError({
                "reader_switch_standard_route": "Select OPEN/NC or CLOSED/NO."
            })
        attrs.setdefault("reader_switch_standard_route", reader_route)

        reader_delay = value("reader_switch_settling_time")
        if reader_delay is not None and not 0 <= float(reader_delay) <= 300:
            raise serializers.ValidationError({
                "reader_switch_settling_time": "Reader switch delay must be between 0 and 300 seconds."
            })

        for field, model, terminal in (
            ("standard_reader_input", std_model, std_input),
            ("test_reader_input", ti_model, ti_input),
        ):
            if model == "8508A":
                if terminal not in {"FRONT", "REAR"}:
                    raise serializers.ValidationError({field: "Select FRONT or REAR."})
                attrs[field] = terminal
            elif is_5790(model):
                if terminal not in {"INPUT1", "INPUT2"}:
                    raise serializers.ValidationError({field: "Select Input 1 or Input 2."})
                attrs[field] = terminal

        if (
            std_model == "8508A"
            and ti_model == "8508A"
            and std_address
            and std_address == ti_address
            and std_input == ti_input
        ):
            raise serializers.ValidationError(
                {
                    "test_reader_input": (
                        "A single 8508A must use different terminals for the "
                        "Standard and Test Instrument roles."
                    )
                }
            )
        if (
            is_5790(std_model)
            and is_5790(ti_model)
            and std_address
            and std_address == ti_address
            and std_input == ti_input
        ):
            raise serializers.ValidationError(
                {
                    "test_reader_input": (
                        "A single 5790A/B must use different inputs for the "
                        "Standard and Test Instrument roles."
                    )
                }
            )
        return attrs

class CalibrationTVCCorrectionsSerializer(serializers.ModelSerializer):
    Standard = serializers.DictField(required=False)
    Test = serializers.DictField(required=False)

    class Meta:
        model = CalibrationTVCCorrections
        fields = ['Standard', 'Test']

    def to_representation(self, instance):
        corrections = instance.corrections_data or {}
        return {
            "Standard": corrections.get("Standard", {}),
            "Test": corrections.get("Test", {}),
        }

    def update(self, instance, validated_data):
        corrections = {
            "Standard": validated_data.get("Standard", {}),
            "Test": validated_data.get("Test", {}),
        }
        instance.corrections_data = corrections
        instance.save()
        return instance

class CalibrationConfigurationsSerializer(serializers.ModelSerializer):
    test_point = serializers.PrimaryKeyRelatedField(read_only=True)
    class Meta:
        model = CalibrationConfigurations
        fields = '__all__'

class CalibrationSettingsSerializer(serializers.ModelSerializer):
    test_point = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = CalibrationSettings
        fields = [
            'test_point',
            'initial_warm_up_time',
            'num_samples',
            'settling_time',
            'nplc',
            'input_switch_settling_time',
            'f8508_dc_filter_enabled',
            'f8508_dc_resolution',
            'f8508_dc_fast_enabled',
            'f8508_ac_filter_hz',
            'f8508_ac_resolution',
            'f8508_ac_transfer_enabled',
            'f8508_ac_dc_coupled',
            'f5790_filter_mode',
            'f5790_filter_restart',
            'f5790_hires_enabled',
            'f5790_range_mode',
            'f5790_input_switch_settling_time',
            'stability_check_method',
            'stability_window',
            'stability_threshold_ppm',
            'stability_max_attempts',
            'iqr_filter_enabled',
            'iqr_filter_ppm_threshold',
            'ignore_instability_after_lock',
            'characterize_test_first',
            'characterize_std_first',
            'characterization_source',
            'enable_low_frequency_settings',
            'enable_11hz_filter',
            'lf_harmonic_projection',
            'min_low_freq_settling_time',
            'lf_harmonics',
            'n_cycles',
        ]

    def validate_n_cycles(self, value):
        """n_cycles is a single source of truth shared across both directions
        and stays editable even after cycles have been captured. The save path
        mirrors the value onto the opposite direction so the pair stays in
        sync, and the aggregation path caps to the configured N (using only the
        first N cycles of each direction), so changing N never strands or
        double-counts collected cycles. Min value is enforced by the model's
        validator.
        """
        return value

    def validate_input_switch_settling_time(self, value):
        if value is not None and not 0 <= value <= 65000:
            raise serializers.ValidationError(
                "The 8508A input-switch delay must be between 0 and 65000 seconds."
            )
        return value

    def validate_f8508_dc_resolution(self, value):
        if value not in (5, 6, 7, 8):
            raise serializers.ValidationError("DC resolution must be 5, 6, 7, or 8.")
        return value

    def validate_f8508_ac_resolution(self, value):
        if value not in (5, 6):
            raise serializers.ValidationError("AC resolution must be 5 or 6.")
        return value

    def validate_f8508_ac_filter_hz(self, value):
        if value not in (10, 40, 100):
            raise serializers.ValidationError("AC filter must be 10, 40, or 100 Hz.")
        return value

    def validate_f5790_filter_mode(self, value):
        value = str(value).upper()
        if value not in {"OFF", "FAST", "MEDIUM", "SLOW"}:
            raise serializers.ValidationError("5790 filter must be Off, Fast, Medium, or Slow.")
        return value

    def validate_f5790_filter_restart(self, value):
        value = str(value).upper()
        if value not in {"FINE", "MEDIUM", "COARSE"}:
            raise serializers.ValidationError("5790 filter restart must be Fine, Medium, or Coarse.")
        return value

    def validate_f5790_range_mode(self, value):
        value = str(value).upper()
        if value not in {"AUTO", "POINT"}:
            raise serializers.ValidationError("5790 range mode must be Auto or Test point.")
        return value

    def validate_f5790_input_switch_settling_time(self, value):
        if not 0 <= value <= 300:
            raise serializers.ValidationError("5790 input-switch delay must be between 0 and 300 seconds.")
        return value

class FormattedReadingsField(serializers.Field):
    """ Custom serializer field to add a human-readable timestamp. """
    def to_representation(self, value):
        if not isinstance(value, list):
            return value
        
        formatted_readings = []
        for point in value:
            if isinstance(point, dict) and 'timestamp' in point:
                point['timestamp_formatted'] = datetime.fromtimestamp(point['timestamp']).strftime('%Y-%m-%d %H:%M:%S')
            formatted_readings.append(point)
        return formatted_readings

class CalibrationReadingsSerializer(serializers.ModelSerializer):
    test_point = serializers.PrimaryKeyRelatedField(read_only=True)
    std_ac_open_readings = FormattedReadingsField()
    std_dc_pos_readings = FormattedReadingsField()
    std_dc_neg_readings = FormattedReadingsField()
    std_ac_close_readings = FormattedReadingsField()
    ti_ac_open_readings = FormattedReadingsField()
    ti_dc_pos_readings = FormattedReadingsField()
    ti_dc_neg_readings = FormattedReadingsField()
    ti_ac_close_readings = FormattedReadingsField()

    class Meta:
        model = CalibrationReadings
        fields = '__all__'

class CalibrationResultsCycleSerializer(serializers.ModelSerializer):
    class Meta:
        model = CalibrationResultsCycle
        fields = [
            'id', 'cycle_index', 'delta_uut_ppm',
            'std_ac_open_avg', 'std_dc_pos_avg', 'std_dc_neg_avg', 'std_ac_close_avg',
            'ti_ac_open_avg', 'ti_dc_pos_avg', 'ti_dc_neg_avg', 'ti_ac_close_avg',
            'std_ac_open_stddev', 'std_dc_pos_stddev', 'std_dc_neg_stddev', 'std_ac_close_stddev',
            'ti_ac_open_stddev', 'ti_dc_pos_stddev', 'ti_dc_neg_stddev', 'ti_ac_close_stddev',
            'created_at',
        ]


class CalibrationResultsSerializer(serializers.ModelSerializer):
    test_point = serializers.PrimaryKeyRelatedField(read_only=True)
    cycles = CalibrationResultsCycleSerializer(many=True, read_only=True)
    # Canonical, server-computed pair analytics blob. The frontend's
    # CycleStatisticsTracker, CalibrationResults summary, and Calibration
    # calculate-tab all consume this same payload so their numbers cannot
    # diverge. None when there is no opposite-direction sibling yet.
    pair_analytics = serializers.SerializerMethodField()

    class Meta:
        model = CalibrationResults
        fields = '__all__'

    def get_pair_analytics(self, obj):
        try:
            # ``sibling_map`` is injected by TestPointViewSet.list to skip
            # the per-point sibling DB lookup. None on detail calls; the
            # model method falls back to its own query in that case.
            sibling_map = self.context.get('sibling_map') if hasattr(self, 'context') else None
            return obj.build_pair_analytics(sibling_map=sibling_map)
        except Exception:
            return None

class TestPointSerializer(serializers.ModelSerializer):
    settings = CalibrationSettingsSerializer(required=False)
    readings = CalibrationReadingsSerializer(required=False)
    results = CalibrationResultsSerializer(required=False)
    class Meta:
        model = TestPoint
        fields = ['id', 'current', 'frequency', 'direction', 'is_stability_failed', 'settings', 'readings', 'results']
    
    def update(self, instance, validated_data):
        settings_data = validated_data.pop('settings', None)
        if settings_data:
            CalibrationSettings.objects.update_or_create(test_point=instance, defaults=settings_data)

        readings_data = validated_data.pop('readings', None)
        if readings_data:
            CalibrationReadings.objects.update_or_create(test_point=instance, defaults=readings_data)

        results_data = validated_data.pop('results', None)
        if results_data:
            CalibrationResults.objects.update_or_create(test_point=instance, defaults=results_data)

        return super().update(instance, validated_data)

class TestPointSetSerializer(serializers.ModelSerializer):
    points = TestPointSerializer(many=True) 

    class Meta:
        model = TestPointSet
        fields = '__all__'
        
    def _handle_nested_one_to_one(self, parent_instance, field_name, nested_data, nested_serializer_class, nested_model_class):
        if nested_data is not None:
            nested_instance = getattr(parent_instance, field_name, None) 
            if nested_instance:
                nested_serializer = nested_serializer_class(nested_instance, data=nested_data, partial=True)
            else:
                nested_serializer = nested_serializer_class(data=nested_data)
            nested_serializer.is_valid(raise_exception=True)
            nested_serializer.save(**{parent_instance._meta.model_name: parent_instance})

    def update(self, instance, validated_data):
        points_data = validated_data.pop('points', [])
        existing_test_points = {tp.id: tp for tp in instance.points.all()}
        
        for point_data in points_data:
            point_id = point_data.get('id')
            settings_data = point_data.pop('settings', None)
            readings_data = point_data.pop('readings', None)
            results_data = point_data.pop('results', None)

            if point_id and point_id in existing_test_points:
                test_point_instance = existing_test_points[point_id]
                test_point_serializer = TestPointSerializer(test_point_instance, data=point_data, partial=True)
                test_point_serializer.is_valid(raise_exception=True)
                test_point_instance = test_point_serializer.save()
                self._handle_nested_one_to_one(test_point_instance, 'settings', settings_data, CalibrationSettingsSerializer, CalibrationSettings)
                self._handle_nested_one_to_one(test_point_instance, 'readings', readings_data, CalibrationReadingsSerializer, CalibrationReadings)
                self._handle_nested_one_to_one(test_point_instance, 'results', results_data, CalibrationResultsSerializer, CalibrationResults)
            else:
                test_point_serializer = TestPointSerializer(data=point_data, partial=True)
                test_point_serializer.is_valid(raise_exception=True)
                test_point_instance = test_point_serializer.save(test_point_set=instance) 
                if settings_data: CalibrationSettings.objects.create(test_point=test_point_instance, **settings_data)
                if readings_data: CalibrationReadings.objects.create(test_point=test_point_instance, **readings_data)
                if results_data: CalibrationResults.objects.create(test_point=test_point_instance, **results_data)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save() 
        return instance 

class CalibrationSerializer(serializers.ModelSerializer):
    tvc_corrections = CalibrationTVCCorrectionsSerializer(source='tvccorrections', required=False, allow_null=True)
    configurations = CalibrationConfigurationsSerializer(required=False, allow_null=True)
    test_points = serializers.SerializerMethodField()

    class Meta:
        model = Calibration
        fields = ['id', 'session', 'tvc_corrections', 'configurations', 'test_points']

    def get_test_points(self, obj):
        try:
            session = obj.session
            test_point_set = TestPointSet.objects.get(session=session)
            return TestPointSetSerializer(test_point_set).data
        except TestPointSet.DoesNotExist:
            return None
        except Exception:
            return None

    def update(self, instance, validated_data):
        tvc_corrections_data = validated_data.pop('tvccorrections', None)
        configurations_data = validated_data.pop('configurations', None)
        instance.session = validated_data.get('session', instance.session)
        instance.save()

        if tvc_corrections_data is not None:
            tvc_corrections_instance, _ = CalibrationTVCCorrections.objects.get_or_create(calibration=instance)
            tvc_corrections_serializer = CalibrationTVCCorrectionsSerializer(tvc_corrections_instance, data=tvc_corrections_data, partial=True)
            if tvc_corrections_serializer.is_valid(raise_exception=True):
                tvc_corrections_serializer.save()

        if configurations_data is not None:
            configurations_instance, _ = CalibrationConfigurations.objects.get_or_create(calibration=instance)
            configurations_serializer = CalibrationConfigurationsSerializer(configurations_instance, data=configurations_data, partial=True)
            if configurations_serializer.is_valid(raise_exception=True):
                configurations_serializer.save()

        return instance

class BugReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = BugReport
        fields = '__all__'
