from django.apps import AppConfig


class ReportsConfig(AppConfig):
    """Report of Calibration module — the backend counterpart of the frontend
    ``modules/reports`` tool. Its tables (MeasurementArea, ROCRecord) route to
    the dedicated ``reports`` database alias via WorkbenchRouter."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'reports'
    verbose_name = 'Report of Calibration'
