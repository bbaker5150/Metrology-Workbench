# api/urls.py
from django.urls import path, include
from rest_framework_nested import routers
from .views import (
    MessageViewSet, ShuntViewSet, ShuntReportViewSet, TVCViewSet, TVCReportViewSet,
    CalibrationSessionViewSet, TestPointViewSet, discover_instruments, system_info,
    BugReportViewSet, WorkstationViewSet,
)

router = routers.SimpleRouter()
router.register(r'messages', MessageViewSet, basename='message')
router.register(r'calibration_sessions', CalibrationSessionViewSet, basename='calibrationsession')
router.register(r'shunts', ShuntViewSet, basename='shunt')
router.register(r'tvcs', TVCViewSet, basename='tvc')
router.register(r'bug_reports', BugReportViewSet, basename='bugreport')
router.register(r'workstations', WorkstationViewSet, basename='workstation')

test_point_router = routers.NestedSimpleRouter(router, r'calibration_sessions', lookup='session')
test_point_router.register(r'test_points', TestPointViewSet, basename='session-test-point')

# Dated Reports of Calibration nested under their device.
shunt_report_router = routers.NestedSimpleRouter(router, r'shunts', lookup='shunt')
shunt_report_router.register(r'reports', ShuntReportViewSet, basename='shunt-report')

tvc_report_router = routers.NestedSimpleRouter(router, r'tvcs', lookup='tvc')
tvc_report_router.register(r'reports', TVCReportViewSet, basename='tvc-report')

urlpatterns = [
    path('calibration_sessions/<int:session_pk>/test_points/<int:pk>/clear_readings/',
         TestPointViewSet.as_view({'post': 'clear_readings'}),
         name='testpoint-clear-readings'),
    

    path('system_info/', system_info, name='system_info'),
    
    path('', include(router.urls)),
    path('', include(test_point_router.urls)),
    path('', include(shunt_report_router.urls)),
    path('', include(tvc_report_router.urls)),
    path('instruments/discover/', discover_instruments, name='discover-instruments'),
]