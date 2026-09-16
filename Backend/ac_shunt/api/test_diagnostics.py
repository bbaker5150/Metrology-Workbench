import json
import logging
import tempfile
from pathlib import Path
from logging.handlers import RotatingFileHandler
from unittest.mock import patch
from django.test import SimpleTestCase, RequestFactory
from .diagnostics import DiagnosticASGI, DiagnosticFormatter, client_event


class DiagnosticsTests(SimpleTestCase):
    def test_records_survive_rotation_on_disk(self):
        from .diagnostics import event
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'backend.jsonl'
            handler = RotatingFileHandler(target, maxBytes=700, backupCount=2, encoding='utf-8')
            handler.setFormatter(DiagnosticFormatter())
            log = logging.getLogger('api.diagnostics')
            old_level = log.level
            log.setLevel(logging.INFO)
            log.addHandler(handler)
            try:
                for index in range(10):
                    event('http_finished', path='/probe', status=404, sequence=index)
            finally:
                log.removeHandler(handler)
                log.setLevel(old_level)
                handler.close()
            files = list(Path(folder).glob('backend.jsonl*'))
            self.assertGreater(len(files), 1)
            self.assertLessEqual(len(files), 3)
            rows = [json.loads(line) for file in files for line in file.read_text().splitlines()]
            self.assertTrue(all(row['boot_id'] and row['pid'] for row in rows))

    def test_client_payload_is_bounded_and_whitelisted(self):
        request = RequestFactory().post('/diagnostics/events/', data=json.dumps({
            'event': 'socket_closed', 'session_id': 89, 'password': 'never-log-this', 'reason': 'x' * 500,
        }), content_type='application/json')
        with patch('api.diagnostics.event') as log:
            self.assertEqual(client_event(request).status_code, 200)
        details = log.call_args.kwargs
        self.assertNotIn('password', str(details))
        self.assertEqual(len(details['client_reason']), 200)
        self.assertEqual(client_event(RequestFactory().post('/', data='x' * 5000, content_type='application/json')).status_code, 413)

    def test_log_identifies_process_and_boot(self):
        record = logging.LogRecord('test', logging.WARNING, '', 1, 'message', (), None)
        payload = json.loads(DiagnosticFormatter().format(record))
        self.assertTrue(payload['pid'])
        self.assertTrue(payload['boot_id'])
        self.assertIn('time', payload)

    async def test_scanner_request_is_logged_without_query_or_cookies(self):
        async def app(scope, receive, send):
            await send({'type': 'http.response.start', 'status': 404})
        async def noop(*args): pass
        with patch('api.diagnostics.event') as log:
            await DiagnosticASGI(app)({'type': 'http', 'path': '/.env', 'method': 'GET', 'client': ('192.0.2.1', 123),
                'query_string': b'password=secret', 'headers': [(b'cookie', b'secret')]}, noop, noop)
        self.assertEqual(log.call_args.kwargs['status'], 404)
        self.assertNotIn('secret', str(log.call_args))

    async def test_socket_disconnect_records_close_code_and_path(self):
        async def app(scope, receive, send): await receive()
        async def receive(): return {'type': 'websocket.disconnect', 'code': 1006}
        async def send(message): pass
        with patch('api.diagnostics.event') as log:
            await DiagnosticASGI(app)({'type': 'websocket', 'path': '/ws/collect-readings/89/'}, receive, send)
        self.assertTrue(any(call.args[0] == 'websocket_disconnect' and call.kwargs['code'] == 1006 for call in log.call_args_list))

    async def test_commands_and_roles_are_recorded_without_command_payload(self):
        async def app(scope, receive, send):
            await receive()
            await send({'type':'websocket.send','text':'{"type":"role_assigned","role":"remote"}'})
            await send({'type':'websocket.send','bytes':b'\x00','text':None})
        async def receive(): return {'type':'websocket.receive','text':'{"command":"stop_collection","secret":"do-not-log"}'}
        async def send(message): pass
        with patch('api.diagnostics.event') as log:
            await DiagnosticASGI(app)({'type':'websocket','path':'/ws/collect-readings/89/'},receive,send)
        self.assertNotIn('do-not-log', str(log.call_args_list))
        self.assertTrue(any(call.kwargs.get('command') == 'stop_collection' for call in log.call_args_list))
        self.assertTrue(any(call.kwargs.get('role') == 'remote' for call in log.call_args_list))
