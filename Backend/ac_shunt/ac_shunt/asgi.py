# ac_shunt/asgi.py
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack # Or SessionMiddlewareStack, or just URLRouter

# Per-module WebSocket routings. Each module owns its own ws/<module>/ patterns
# (see docs/adding-a-module.md); we concatenate them into one URLRouter. The
# AC-Shunt module keeps its existing ws/... routes; the uncertainty/reports
# modules are wired but currently expose no consumers (empty lists).
from api import routing as api_routing
from uncertainty import routing as uncertainty_routing
from reports import routing as reports_routing

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ac_shunt.settings')

django_asgi_app = get_asgi_application() # Handles HTTP

websocket_urlpatterns = (
    api_routing.websocket_urlpatterns
    + uncertainty_routing.websocket_urlpatterns
    + reports_routing.websocket_urlpatterns
)

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack( # Or just URLRouter if no auth needed initially
        URLRouter(
            websocket_urlpatterns
        )
    ),
})

from api.diagnostics import DiagnosticASGI, start_lifecycle
start_lifecycle()
application = DiagnosticASGI(application)
