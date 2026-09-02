"""
URL routes for the Report of Calibration module.

Included by the project URLconf under ``/api/reports/``.
"""
from django.urls import path

from . import views

app_name = "reports"

urlpatterns = [
    path("info/", views.module_info, name="module-info"),
    path("areas/", views.areas, name="areas"),
    path("rocs/", views.rocs, name="rocs"),
    path("rocs/<int:roc_id>/", views.roc_detail, name="roc-detail"),
    path("rocs/<int:roc_id>/excel/", views.roc_excel, name="roc-excel"),
    path("roc/generate/", views.roc_generate, name="roc-generate"),
    path("roc/template/", views.roc_template, name="roc-template"),
    path("roc/parse/", views.roc_parse, name="roc-parse"),
    path("ac-shunt/sessions/", views.ac_shunt_sessions, name="ac-shunt-sessions"),
    path("ac-shunt/sessions/<int:session_id>/pull/", views.ac_shunt_session_pull, name="ac-shunt-session-pull"),
]
