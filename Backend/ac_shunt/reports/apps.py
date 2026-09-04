from django.apps import AppConfig


class ReportsConfig(AppConfig):
    """Report of Calibration module — the backend counterpart of the frontend
    ``modules/reports`` tool. Its table (ROCRecord) routes to the dedicated
    ``reports`` database alias via WorkbenchRouter. Measurement area
    definitions are plain JSON files (see area_registry.py), not a model."""

    default_auto_field = 'django.db.models.BigAutoField'
    name = 'reports'
    verbose_name = 'Report of Calibration'
