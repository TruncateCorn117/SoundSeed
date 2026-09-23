#!/usr/bin/env python3
"""Serve only the packaged SoundSeed app on a private localhost port."""

import argparse
import functools
import http.server
import os
from pathlib import Path
import sys
import threading
import webbrowser


APP_ROOT = Path(__file__).resolve().parent / "app"


class LocalAppHandler(http.server.SimpleHTTPRequestHandler):
    """Read-only static files; no listings and no symlink escape."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".json": "application/json",
    }

    def parse_request(self):
        if not super().parse_request():
            return False
        if self.command not in ("GET", "HEAD"):
            self.send_response(405, "Method Not Allowed")
            self.send_header("Allow", "GET, HEAD")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False
        return True

    def send_head(self):
        target = Path(self.translate_path(self.path)).resolve()
        try:
            within_app = os.path.commonpath((str(APP_ROOT), str(target))) == str(APP_ROOT)
        except ValueError:
            within_app = False
        if not within_app:
            self.send_error(403, "Files outside the app are unavailable")
            return None
        if target.is_dir():
            for name in ("index.html", "index.htm"):
                index = target / name
                if index.exists() and os.path.commonpath((str(APP_ROOT), str(index.resolve()))) != str(APP_ROOT):
                    self.send_error(403, "Files outside the app are unavailable")
                    return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def log_message(self, format, *args):
        # Keep the launcher readable. This server has no user-data endpoints.
        pass


def main():
    parser = argparse.ArgumentParser(description="Open the bundled SoundSeed app locally.")
    parser.add_argument("--no-browser", action="store_true", help="Print the address without opening a browser.")
    options = parser.parse_args()
    if sys.version_info < (3, 8):
        print("SoundSeed requires Python 3.8 or newer.", file=sys.stderr)
        return 1
    if not (APP_ROOT / "index.html").is_file():
        print("SoundSeed cannot find app/index.html. Extract the complete release folder before starting.", file=sys.stderr)
        return 1

    handler = functools.partial(LocalAppHandler, directory=str(APP_ROOT))
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    except OSError as error:
        print("SoundSeed could not start its local file server: " + str(error), file=sys.stderr)
        return 1
    server.daemon_threads = True
    url = "http://127.0.0.1:{}/".format(server.server_address[1])
    print("\nSoundSeed v0.1 — local sound search", flush=True)
    print("Open this address: " + url, flush=True)
    print("Audio analysis runs in your browser. Recordings are not uploaded.", flush=True)
    print("Keep this window open. Press Ctrl+C to stop.\n", flush=True)

    if not options.no_browser:
        opener = threading.Timer(0.25, webbrowser.open, args=(url,))
        opener.daemon = True
        opener.start()
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        print("\nSoundSeed stopped.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
