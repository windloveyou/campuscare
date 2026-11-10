"""Launch the local demo without downloading anything or changing saved settings."""

from http.client import HTTPConnection, HTTPException
import os
from threading import Thread
import webbrowser

import server


HOST = "127.0.0.1"
PORT = 8830


class DemoServer(server.ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let two processes listen on the same port.
    allow_reuse_address = os.name != "nt"


def campuscare_is_running(port):
    connection = HTTPConnection(HOST, port, timeout=2)
    try:
        connection.request("GET", "/")
        response = connection.getresponse()
        page = response.read(16384)
        return response.status == 200 and b"<title>SmartCampus" in page and b'"/landing.js"' in page
    except (OSError, HTTPException):
        return False
    finally:
        connection.close()


def show_homepage(url):
    try:
        if webbrowser.open(url):
            return
    except (OSError, webbrowser.Error):
        pass
    print(f"Open this address in your browser: {url}", flush=True)


def run_demo(port=PORT):
    url = f"http://{HOST}:{port}/"
    if port and campuscare_is_running(port):
        print(f"SmartCampus is already running at {url}", flush=True)
        show_homepage(url)
        return 0

    try:
        http = DemoServer((HOST, port), server.Handler)
    except OSError:
        if campuscare_is_running(port):
            print(f"SmartCampus is already running at {url}", flush=True)
            show_homepage(url)
            return 0
        print(f"Cannot listen on {HOST}:{port}. Check whether another app is using this port.", flush=True)
        return 1

    with http:
        server.seed()
        url = f"http://{HOST}:{http.server_port}/"
        print(f"SmartCampus is running at {url}", flush=True)
        print("Keep this window open during the demo. Press Ctrl+C to stop.", flush=True)
        Thread(target=show_homepage, args=(url,), daemon=True).start()
        try:
            http.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(run_demo())
