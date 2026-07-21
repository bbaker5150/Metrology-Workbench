"""
URL routes for the Uncertainty Budget module.

Included by the project URLconf under ``/api/uncertainty/``.
"""
from django.urls import path

from . import views

app_name = "uncertainty"

urlpatterns = [
    path("info/", views.module_info, name="module-info"),
    path("system_info/", views.system_info, name="system-info"),

    path("sessions/", views.sessions, name="sessions"),
    path("sessions/<int:session_id>/", views.session_detail, name="session-detail"),
    path("sessions/<int:session_id>/notes/", views.session_notes, name="session-notes"),
    path("sessions/<int:session_id>/images/", views.session_images, name="session-images"),
    path(
        "sessions/<int:session_id>/images/<str:image_id>/",
        views.session_image_detail,
        name="session-image-detail",
    ),

    path("instruments/", views.instruments, name="instruments"),
    path("instruments/<str:instrument_id>/", views.instrument_detail, name="instrument-detail"),

    path("equations/", views.equations, name="equations"),
    path("equations/<str:equation_id>/", views.equation_detail, name="equation-detail"),

    path("bug_reports/", views.bug_reports, name="bug-reports"),
    path("bug_reports/<str:report_id>/", views.bug_report_detail, name="bug-report-detail"),
]
