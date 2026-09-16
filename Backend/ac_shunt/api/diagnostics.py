"""Persistent lifecycle/transport evidence. Never records request bodies or credentials."""
import atexit
import faulthandler
import json
import logging
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

BOOT_ID = uuid.uuid4().hex
STARTED = time.monotonic()
logger = logging.getLogger("api.diagnostics")
_started = False
_fault_file = None


class DiagnosticFormatter(logging.Formatter):
    def format(self, record):
        payload = {"time": datetime.now(timezone.utc).isoformat(), "pid": os.getpid(),
                   "boot_id": BOOT_ID, "level": record.levelname, "logger": record.name,
                   "message": record.getMessage(), "uptime_s": round(time.monotonic() - STARTED, 3)}
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


def event(name, **details):
    logger.info(json.dumps({"event": name, **details}, ensure_ascii=True, default=str))


def start_lifecycle():
    global _started, _fault_file
    if _started:
        return
    _started = True
    event("backend_started", parent_pid=os.getppid(), python=sys.version.split()[0],
          executable=sys.executable, autoreload_child=os.environ.get("RUN_MAIN", "false"))
    print(f"Backend diagnostics active: {Path(settings.DIAGNOSTICS_DIR) / f'backend-{os.getpid()}.jsonl'}", flush=True)
    try:
        folder = Path(settings.DIAGNOSTICS_DIR)
        folder.mkdir(parents=True, exist_ok=True)
        _fault_file = (folder / f"fault-{os.getpid()}.log").open("a", encoding="utf-8")
        faulthandler.enable(file=_fault_file, all_threads=True)
    except (OSError, RuntimeError):
        logger.exception("Cannot enable native crash diagnostics")
    atexit.register(lambda: event("backend_exit", kind="python_exit"))
    previous_hook = sys.excepthook
    def exception_hook(kind, value, tb):
        logger.critical("Uncaught backend exception", exc_info=(kind, value, tb))
        previous_hook(kind, value, tb)
    sys.excepthook = exception_hook
    def pulse():
        while True:
            time.sleep(60)
            event("backend_alive")
    threading.Thread(target=pulse, name="diagnostic-heartbeat", daemon=True).start()


class DiagnosticASGI:
    def __init__(self, application):
        self.application = application

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            return await self.application(scope, receive, send)
        began = time.monotonic()
        request_id = uuid.uuid4().hex[:12]
        headers = dict(scope.get("headers", []))
        details = {"request_id": request_id, "path": str(scope.get("path", ""))[:300],
                   "peer": scope.get("client"), "method": scope.get("method"),
                   "user_agent": headers.get(b"user-agent", b"").decode("latin1")[:160]}
        status = None
        if kind == "websocket":
            event("websocket_connect", **details)
        async def diagnostic_receive():
            message = await receive()
            if message["type"] == "websocket.disconnect":
                event("websocket_disconnect", **details, code=message.get("code"))
            elif message["type"] == "websocket.receive":
                raw = message.get("text") or ""
                if len(raw) < 65536:
                    try:
                        payload = json.loads(raw)
                        command = payload.get("command") if isinstance(payload, dict) else None
                        if command and command not in ("ping", "heartbeat"):
                            event("websocket_command", **details, command=str(command)[:80])
                    except (ValueError, TypeError):
                        event("websocket_invalid_message", **details)
            return message
        async def diagnostic_send(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            elif message["type"] == "websocket.close":
                event("websocket_server_close", **details, code=message.get("code"))
            elif message["type"] == "websocket.send" and '"role_assigned"' in (message.get("text") or "")[:200]:
                try:
                    payload = json.loads(message["text"])
                    if payload.get("type") == "role_assigned":
                        event("websocket_role", **details, role=payload.get("role"))
                except (ValueError, TypeError, AttributeError):
                    pass
            await send(message)
        try:
            await self.application(scope, diagnostic_receive, diagnostic_send)
        except Exception:
            logger.exception("Transport failure %s", details)
            raise
        finally:
            event(f"{kind}_finished", **details, status=status,
                  duration_ms=round((time.monotonic() - began) * 1000))


@csrf_exempt
@require_POST
def client_event(request):
    if int(request.META.get("CONTENT_LENGTH") or 0) > 4096:
        return JsonResponse({"error": "Event too large"}, status=413)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError()
        allowed = ("event", "session_id", "role", "socket", "code", "reason", "visibility", "route")
        details = {key: str(payload[key])[:200] for key in allowed if key in payload}
    except (ValueError, UnicodeError):
        return JsonResponse({"error": "Invalid event"}, status=400)
    event("client_event", peer=request.META.get("REMOTE_ADDR"), **{f"client_{k}": v for k, v in details.items()})
    return JsonResponse({"recorded": True})
