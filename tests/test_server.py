import io
import json
import socket
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import server


class LocalHTTPTests(unittest.TestCase):
    def request(self, method, path, body=b"", origin="http://localhost", ai=True):
        client, handler_socket = socket.socketpair()
        handler_args = (handler_socket, ("127.0.0.1", 0), SimpleNamespace(api_key="mock" if ai else "", model="mock"))

        def handle():
            with handler_socket:
                server.Handler(*handler_args)

        thread = threading.Thread(target=handle)
        with client:
            client.settimeout(5)
            thread.start()
            try:
                client.sendall((
                    f"{method} {path} HTTP/1.0\r\nHost: localhost\r\nOrigin: {origin}\r\n"
                    f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n\r\n"
                ).encode() + body)
                with client.makefile("rb") as response:
                    raw = response.read()
            finally:
                client.close()
                thread.join(5)
        headers, _, content = raw.partition(b"\r\n\r\n")
        return int(headers.split()[1]), headers, content

    def practice(self, operation, messages, **kwargs):
        body = json.dumps({"scene": "虚构练习", "goal": "听完再反馈", "messages": messages}).encode()
        status, _, content = self.request("POST", "/api/" + operation, body, **kwargs)
        return status, json.loads(content)

    def test_serves_only_expected_assets(self):
        status, headers, content = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Content-Security-Policy", headers)
        self.assertIn(b"lab.js", content)
        for path in ("/lab.js", "/style.css"):
            self.assertEqual(self.request("GET", path)[0], 200)
        for path in ("/.env", "/.git/config", "/server.py"):
            self.assertEqual(self.request("GET", path)[0], 404)

    def test_offline_status(self):
        self.assertEqual(json.loads(self.request("GET", "/api/status", ai=False)[2]), {"ai": False})

    def test_ai_protocol_and_cross_origin_rejection(self):
        messages = [{"role": "assistant", "content": "开场"}, {"role": "user", "content": "你怎么看？"}]
        with patch.object(server, "ask_model", return_value={"reply": "我先解释一下"}) as model:
            self.assertEqual(self.practice("reply", messages, origin="https://example.test")[0], 403)
            self.assertEqual(self.practice("reply", messages, ai=False)[0], 503)
            self.assertEqual(self.practice("review", messages)[0], 400)
            model.assert_not_called()
            self.assertEqual(self.practice("reply", messages), (200, {"reply": "我先解释一下"}))
            model.assert_called_once()

    def test_model_evidence_index_and_redirect(self):
        opener = SimpleNamespace(open=lambda *args, **kwargs: io.BytesIO(json.dumps({
            "choices": [{"message": {"content": json.dumps({"turn": 2, "feedback": "观察", "action": "试一试"})}}]
        }).encode()))
        with patch.object(server, "build_opener", return_value=opener):
            self.assertEqual(server.ask_model("review", {}, 2, "mock", "mock")["turn"], 2)
            with self.assertRaises(ValueError):
                server.ask_model("review", {}, 1, "mock", "mock")
        redirect = server.RefuseRedirect()
        self.assertIsNone(redirect.redirect_request(
            server.Request(server.ENDPOINT), None, 302, "Found", {}, "https://example.test"
        ))


if __name__ == "__main__":
    unittest.main()
