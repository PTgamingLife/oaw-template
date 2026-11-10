"""OAW 測試版:在 Cloud Shell 裡開一個手機友善的小網頁(port 8080)。

只綁 127.0.0.1,外部只能透過 Cloud Shell Web Preview(需本人 Google 登入)進來。
"""

import json
import os
import socket
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

OAW_PORT = int(os.environ.get("OAW_PORT", "8080"))
OAW_WEB_DIR = Path(__file__).resolve().parent / "web"


class OawHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(OAW_WEB_DIR), **kwargs)

    def do_GET(self):
        if self.path == "/api/oaw_ping":
            oaw_body = json.dumps({
                "oaw_ok": True,
                "oaw_host": socket.gethostname(),
                "oaw_user": os.environ.get("USER", ""),
                "oaw_cloudshell": bool(os.environ.get("CLOUD_SHELL")),
                "oaw_time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(oaw_body)
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stderr.write("[oaw] " + fmt % args + "\n")


def main():
    oaw_server = ThreadingHTTPServer(("127.0.0.1", OAW_PORT), OawHandler)
    print(f"[oaw] 網頁已啟動:port {OAW_PORT}(Ctrl+C 結束)", flush=True)
    try:
        oaw_server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
